import {Elysia, t} from 'elysia'
import {basename} from 'path'
import {readFile, stat, writeFile} from 'fs/promises'
import {authGuard} from '../plugins/auth-guard'
import {getContainer, getContainerStats, listContainers} from '../docker'
import type {LogCollector} from '../log-collector'
import type {StorageAdapter} from '../storage'
import {ServiceResolver} from '../service-resolver'
import {formatBytes, formatUptime} from '../utils'
import {applyComposeEnvOperations, type EnvOperation} from '../compose-env'
import {
    getComposeImageVariableNames,
    getRequiredComposeImageVariableNames,
    getServiceImageTemplate,
    inferComposeImageVariables,
} from '../compose-image-vars'

const envCommitLocks = new Set<string>()

export function containerRoutes(deps: { storage: StorageAdapter; collector: LogCollector }) {
  const {storage, collector} = deps
    const resolver = new ServiceResolver(storage)

  return new Elysia({prefix: '/api/containers'})
      .use(authGuard)
      .get('/', async () => {
        const containers = await listContainers(true) as any[]
        const results = []
        for (const c of containers) {
            const name = c.Names?.[0]?.replace(/^\//, '') || ''
            const labels: Record<string, string> = c.Labels || {}
            let serviceUuid = ''
            try {
                serviceUuid = await resolver.resolve(labels, name)
            } catch {
            }

            const watched = serviceUuid
                ? await storage.isContainerWatched(serviceUuid)
                : collector.isWatching(c.Id)

            results.push({
                id: serviceUuid,
                dockerId: c.Id,
                name,
                image: c.Image,
                state: c.State,
                status: c.Status,
                created: c.Created,
                ports: c.Ports,
                watched,
                stats: null,
            })
        }
        return results
      })
      .get('/:uuid', async ({params}) => {
          const containerId = await resolveContainerId(params.uuid, storage, resolver)
          if (!containerId) return {id: params.uuid, name: '', state: 'removed', watched: false}

          const info = await getContainer(containerId)
        const state = info.State
        const uptime = state?.StartedAt ? formatUptime(state.StartedAt) : null

        let stats: ReturnType<typeof extractStats> = null
        if (state?.Running) {
            try {
                stats = extractStats(await getContainerStats(containerId), info)
            } catch {
            }
        }

          const labels: Record<string, string> = info.Config?.Labels || {}
          const serviceUuid = await resolver.resolve(labels, info.Name?.replace(/^\//, '') || '')
          const watched = await storage.isContainerWatched(serviceUuid)
          const service = await storage.getServiceByUuid(serviceUuid)

        return {
            id: serviceUuid,
            dockerId: info.Id,
          name: info.Name?.replace(/^\//, ''),
          image: info.Config?.Image,
          state: state?.Status,
          status: state?.Running ? 'running' : state?.Status,
          created: info.Created,
          ports: info.NetworkSettings?.Ports,
          env: info.Config?.Env,
            composePath: service?.composePath ?? null,
            envEditLocked: service?.envEditLocked ?? false,
            envEditLockReason: service?.envEditLockReason ?? null,
            envEditLockedAt: service?.envEditLockedAt ?? null,
            watched,
          health: state?.Health?.Status ?? null,
          exitCode: state?.ExitCode ?? null,
          pid: state?.Pid ?? null,
          restartCount: info.RestartCount ?? null,
          startedAt: state?.StartedAt ?? null,
          finishedAt: state?.FinishedAt ?? null,
          uptime,
          networks: Object.keys(info.NetworkSettings?.Networks || {}),
          restartPolicy: info.HostConfig?.RestartPolicy?.Name ?? null,
          stats,
        }
      }, {
          params: t.Object({uuid: t.String()}),
      })
      .post('/:uuid/env/compose-path/validate', async ({params, body, status}) => {
          const serviceUuid = await resolveExistingServiceUuid(params.uuid, storage, resolver)
          if (!serviceUuid) return status(404, {error: 'Container not found'})
          const service = await storage.getServiceByUuid(serviceUuid)
          if (service?.envEditLocked) {
              return status(409, {error: service.envEditLockReason || 'Environment editor is locked'})
          }

          const result = await validateComposePath(body.composePath)
          if (result.valid) {
              await storage.setServiceComposePath(serviceUuid, body.composePath.trim())
          }
          return result
      }, {
          params: t.Object({uuid: t.String()}),
          body: t.Object({composePath: t.String()}),
      })
      .post('/:uuid/env', async ({params, body, status}) => {
          const guard = await validateEnvMutation(params.uuid, body.composePath, storage, resolver)
          if (!guard.ok) return status(guard.status, {error: guard.error})
          const result = await commitEnvChanges({
              serviceUuid: guard.serviceUuid,
              composePath: guard.composePath,
              projectName: guard.projectName,
              serviceName: guard.serviceName,
              operations: [{type: 'set', key: body.key, value: body.value}],
              storage,
          })
          if (!result.success) return status(500, {error: result.error})
          return result
      }, {
          params: t.Object({uuid: t.String()}),
          body: t.Object({composePath: t.String(), key: t.String(), value: t.String()}),
      })
      .patch('/:uuid/env/:key', async ({params, body, status}) => {
          const guard = await validateEnvMutation(params.uuid, body.composePath, storage, resolver)
          if (!guard.ok) return status(guard.status, {error: guard.error})
          const result = await commitEnvChanges({
              serviceUuid: guard.serviceUuid,
              composePath: guard.composePath,
              projectName: guard.projectName,
              serviceName: guard.serviceName,
              operations: [{type: 'rename', originalKey: params.key, key: body.key, value: body.value}],
              storage,
          })
          if (!result.success) return status(500, {error: result.error})
          return result
      }, {
          params: t.Object({uuid: t.String(), key: t.String()}),
          body: t.Object({composePath: t.String(), key: t.String(), value: t.String()}),
      })
      .delete('/:uuid/env/:key', async ({params, query, status}) => {
          const guard = await validateEnvMutation(params.uuid, query.composePath, storage, resolver)
          if (!guard.ok) return status(guard.status, {error: guard.error})
          const result = await commitEnvChanges({
              serviceUuid: guard.serviceUuid,
              composePath: guard.composePath,
              projectName: guard.projectName,
              serviceName: guard.serviceName,
              operations: [{type: 'delete', key: params.key}],
              storage,
          })
          if (!result.success) return status(500, {error: result.error})
          return result
      }, {
          params: t.Object({uuid: t.String(), key: t.String()}),
          query: t.Object({composePath: t.String()}),
      })
      .post('/:uuid/env/commit', async ({params, body, status}) => {
          const guard = await validateEnvMutation(params.uuid, body.composePath, storage, resolver)
          if (!guard.ok) return status(guard.status, {error: guard.error})
          const result = await commitEnvChanges({
              serviceUuid: guard.serviceUuid,
              composePath: guard.composePath,
              projectName: guard.projectName,
              serviceName: guard.serviceName,
              operations: body.operations as EnvOperation[],
              storage,
          })
          if (!result.success) return status(500, {error: result.error})
          return result
      }, {
          params: t.Object({uuid: t.String()}),
          body: t.Object({
              composePath: t.String(),
              operations: t.Array(t.Union([
                  t.Object({type: t.Literal('set'), key: t.String(), value: t.String()}),
                  t.Object({type: t.Literal('rename'), originalKey: t.String(), key: t.String(), value: t.String()}),
                  t.Object({type: t.Literal('delete'), key: t.String()}),
              ])),
          }),
      })
      .get('/:uuid/stats', async ({params, status}) => {
          const containerId = await resolveContainerId(params.uuid, storage, resolver)
          if (!containerId) return status(404, {error: 'Container not found'})
        try {
            return await getContainerStats(containerId)
        } catch (err: any) {
          return status(500, {error: 'Failed to get stats', details: err.message})
        }
      }, {
          params: t.Object({uuid: t.String()}),
      })
      .post('/:uuid/watch', async ({params, status}) => {
          const containerId = await resolveContainerId(params.uuid, storage, resolver)
          if (!containerId) return status(404, {error: 'Container not found'})
        try {
            const info = await getContainer(containerId)
            const name = info.Name?.replace(/^\//, '') || containerId
            const labels: Record<string, string> = info.Config?.Labels || {}
            const serviceUuid = await resolver.resolve(labels, name)
            await collector.watchContainer(containerId, name, serviceUuid)
          return {success: true, message: `Now watching container ${name}`}
        } catch (err: any) {
          return status(500, {error: 'Failed to watch container', details: err.message})
        }
      }, {
          params: t.Object({uuid: t.String()}),
      })
      .delete('/:uuid/watch', async ({params}) => {
          const containerId = await resolveContainerId(params.uuid, storage, resolver)
          const serviceUuid = await resolveServiceUuid(params.uuid, containerId, storage, resolver)

          if (containerId && collector.isWatching(containerId)) {
              await collector.unwatchContainer(containerId)
          } else if (serviceUuid) {
              await storage.setContainerWatched(serviceUuid, false)
          }

        return {success: true, message: 'Stopped watching container'}
      }, {
          params: t.Object({uuid: t.String()}),
      })
      .get('/:uuid/instances', async ({params}) => {
          return storage.getInstances(params.uuid)
      }, {
          params: t.Object({uuid: t.String()}),
      })
}

async function resolveContainerId(
    uuid: string,
    storage: StorageAdapter,
    resolver: ServiceResolver,
): Promise<string | null> {
    const activeContainerId = await storage.getActiveContainerId(uuid)
    if (activeContainerId) {
        return activeContainerId
    }

    const containers = await listContainers(true) as any[]
    for (const container of containers) {
        if (container.Id === uuid) {
            return container.Id
        }

        const name = container.Names?.[0]?.replace(/^\//, '') || ''
        const labels: Record<string, string> = container.Labels || {}

        try {
            const serviceUuid = await resolver.resolve(labels, name)
            if (serviceUuid === uuid) {
                return container.Id
            }
        } catch {
        }
    }

    return null
}

async function resolveServiceUuid(
    uuid: string,
    containerId: string | null,
    storage: StorageAdapter,
    resolver: ServiceResolver,
): Promise<string | null> {
    const service = await storage.getServiceByUuid(uuid)
    if (service) {
        return service.uuid
    }

    if (!containerId) {
        return null
    }

    try {
        const info = await getContainer(containerId)
        const name = info.Name?.replace(/^\//, '') || containerId
        const labels: Record<string, string> = info.Config?.Labels || {}
        return await resolver.resolve(labels, name)
    } catch {
        return null
    }
}

async function resolveExistingServiceUuid(
    uuid: string,
    storage: StorageAdapter,
    resolver: ServiceResolver,
): Promise<string | null> {
    const service = await storage.getServiceByUuid(uuid)
    if (service) return service.uuid

    const containerId = await resolveContainerId(uuid, storage, resolver)
    return resolveServiceUuid(uuid, containerId, storage, resolver)
}

async function validateEnvMutation(
    uuid: string,
    composePath: string,
    storage: StorageAdapter,
    resolver: ServiceResolver,
): Promise<
    { ok: true; serviceUuid: string; projectName: string; serviceName: string; composePath: string }
    | { ok: false; status: 400 | 404 | 409; error: string }
> {
    const serviceUuid = await resolveExistingServiceUuid(uuid, storage, resolver)
    if (!serviceUuid) return {ok: false, status: 404, error: 'Container not found'}

    const service = await storage.getServiceByUuid(serviceUuid)
    const storedComposePath = service?.composePath?.trim()
    if (!storedComposePath) return {ok: false, status: 400, error: 'Compose path is not validated'}
    if (storedComposePath !== composePath.trim()) {
        return {ok: false, status: 400, error: 'Compose path does not match the validated path'}
    }
    if (!service?.project || !service.service) {
        return {ok: false, status: 400, error: 'Environment editing requires a Docker Compose service'}
    }
    if (service.envEditLocked) {
        return {ok: false, status: 409, error: service.envEditLockReason || 'Environment editor is locked'}
    }

    const validation = await validateComposePath(storedComposePath)
    if (!validation.valid) {
        return {ok: false, status: 400, error: validation.message || 'Compose path is invalid'}
    }

    return {ok: true, serviceUuid, projectName: service.project, serviceName: service.service, composePath: storedComposePath}
}

async function commitEnvChanges({
    serviceUuid,
    serviceName,
    projectName,
    composePath,
    operations,
    storage,
}: {
    serviceUuid: string
    projectName: string
    serviceName: string
    composePath: string
    operations: EnvOperation[]
    storage: StorageAdapter
}): Promise<{ success: true; env: string[] } | { success: false; error: string }> {
    if (envCommitLocks.has(serviceUuid)) {
        return {success: false, error: 'Environment changes are already being applied'}
    }
    envCommitLocks.add(serviceUuid)
    await storage.setServiceEnvEditLock(serviceUuid, true, 'Environment changes are being applied')
    try {
        const composeImageEnv = await inferCurrentComposeImageEnv(composePath, projectName, serviceName)
        const {projectDirectory, env, originalContent} = await applyComposeEnvOperations(composePath, serviceName, operations)
        try {
            await rebuildComposeService(composePath, projectDirectory, serviceName, composeImageEnv)
        } catch (error) {
            await rollbackComposeFile(composePath, originalContent, error)
        }
        await waitForServiceEnv(projectName, serviceName, operations)
        await storage.setServiceEnvEditLock(serviceUuid, false, null)
        return {success: true, env}
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to apply environment changes'
        await storage.setServiceEnvEditLock(serviceUuid, false, null)
        return {success: false, error: message}
    } finally {
        envCommitLocks.delete(serviceUuid)
    }
}

async function rollbackComposeFile(composePath: string, originalContent: string, cause: unknown): Promise<never> {
    const message = cause instanceof Error ? cause.message : 'Failed to rebuild compose service'
    try {
        await writeFile(composePath, originalContent, 'utf8')
    } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : 'unknown error'
        throw new Error(`${message}; rollback failed: ${rollbackMessage}`)
    }
    throw new Error(message)
}

async function inferCurrentComposeImageEnv(
    composePath: string,
    projectName: string,
    serviceName: string,
): Promise<Record<string, string>> {
    const composeContent = await readFile(composePath, 'utf8')
    const imageTemplate = getServiceImageTemplate(composeContent, serviceName)
    const imageVariables = getComposeImageVariableNames(imageTemplate)
    if (imageVariables.length === 0) return {}

    const container = await findRunningComposeContainer(projectName, serviceName)
    if (!container) {
        const requiredVariables = getRequiredComposeImageVariableNames(imageTemplate)
        if (requiredVariables.every(variable => process.env[variable])) return {}
        throw new Error(`Compose image requires ${requiredVariables.join(', ')}, but no running container was found to infer it from`)
    }

    const info = await getContainer(container.Id)
    const imageEnv = inferComposeImageVariables(imageTemplate, info.Config?.Image ?? null)
    const requiredVariables = getRequiredComposeImageVariableNames(imageTemplate)
    const missingVariables = requiredVariables.filter(variable => !imageEnv[variable] && !process.env[variable])
    if (missingVariables.length > 0) {
        throw new Error(`Compose image requires ${missingVariables.join(', ')}, but it could not be inferred from current image "${info.Config?.Image ?? ''}"`)
    }

    return imageEnv
}

async function rebuildComposeService(
    composePath: string,
    cwd: string,
    serviceName: string,
    composeImageEnv: Record<string, string>,
): Promise<void> {
    const child = Bun.spawn(
        ['docker-compose', '-f', composePath, 'up', '-d', '--build', '--force-recreate', '--no-deps', serviceName],
        {cwd, env: {...process.env, ...composeImageEnv}, stdout: 'pipe', stderr: 'pipe'},
    )
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    if (exitCode !== 0) {
        throw new Error((stderr || stdout || `docker-compose exited with code ${exitCode}`).trim())
    }
}

async function waitForServiceEnv(projectName: string, serviceName: string, operations: EnvOperation[]): Promise<void> {
    const expected = new Map<string, string>()
    const deleted = new Set<string>()
    for (const operation of operations) {
        if (operation.type === 'delete') {
            deleted.add(operation.key)
            expected.delete(operation.key)
            continue
        }
        if (operation.type === 'rename' && operation.originalKey !== operation.key) {
            deleted.add(operation.originalKey)
        }
        expected.set(operation.key, operation.value)
        deleted.delete(operation.key)
    }
    const deadline = Date.now() + 60_000
    let lastError = 'Container did not start with the updated environment'

    while (Date.now() < deadline) {
        const container = await findRunningComposeContainer(projectName, serviceName)
        if (container) {
            try {
                const info = await getContainer(container.Id)
                if (info.State?.Running && envMatchesOperations(info.Config?.Env ?? [], expected, deleted)) {
                    return
                }
                lastError = info.State?.Running
                    ? 'Container is running but environment did not refresh'
                    : 'Container is not running after rebuild'
            } catch (error) {
                lastError = error instanceof Error ? error.message : lastError
            }
        }
        await Bun.sleep(1000)
    }

    throw new Error(lastError)
}

async function findRunningComposeContainer(projectName: string, serviceName: string): Promise<any | null> {
    const containers = await listContainers(false) as any[]
    return containers.find(container => {
        const labels: Record<string, string> = container.Labels || {}
        return labels['com.docker.compose.project'] === projectName
            && labels['com.docker.compose.service'] === serviceName
    }) ?? null
}

function envMatchesOperations(actualEnv: string[], expected: Map<string, string>, deleted: Set<string>): boolean {
    const actual = new Map(actualEnv.map(line => {
        const eqIndex = line.indexOf('=')
        return eqIndex < 0 ? [line, ''] : [line.slice(0, eqIndex), line.slice(eqIndex + 1)]
    }))
    for (const [key, value] of expected) {
        if (actual.get(key) !== value) return false
    }
    for (const key of deleted) {
        if (actual.has(key)) return false
    }
    return true
}

async function validateComposePath(composePath: string): Promise<{
    valid: boolean
    exists: boolean
    composeFile: boolean
    message?: string
}> {
    const trimmed = composePath.trim()
    if (!trimmed) {
        return {valid: false, exists: false, composeFile: false, message: 'Compose path is required'}
    }

    const composeFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].includes(basename(trimmed))
    if (!composeFile) {
        return {
            valid: false,
            exists: false,
            composeFile: false,
            message: 'Path must point to a docker compose YAML file'
        }
    }

    try {
        const fileStat = await stat(trimmed)
        if (!fileStat.isFile()) {
            return {valid: false, exists: true, composeFile, message: 'Compose path is not a file'}
        }

        const content = await readFile(trimmed, 'utf8')
        if (!hasComposeServicesSection(content)) {
            return {valid: false, exists: true, composeFile, message: 'Compose file must contain a services section'}
        }

        return {valid: true, exists: true, composeFile, message: 'Compose path validated'}
    } catch {
        return {valid: false, exists: false, composeFile, message: 'Compose path does not exist or cannot be read'}
    }
}

function hasComposeServicesSection(content: string): boolean {
    const lines = content.split(/\r?\n/)
    const servicesIndex = lines.findIndex(line => /^services\s*:\s*(?:#.*)?$/.test(line))
    if (servicesIndex < 0) return false

    for (const line of lines.slice(servicesIndex + 1)) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const indent = line.match(/^\s*/)?.[0].length ?? 0
        if (indent === 0) return false
        if (/^\s{2,}[\w.-]+\s*:/.test(line)) return true
    }

    return false
}

function extractStats(stats: any, info: any) {
  if (!stats && !info?.State?.StartedAt) return null

    let cpuPercent: number | null = null
  let memUsage: string | null = null
  let memPercent: number | null = null
  let diskRead: string | null = null
  let diskWrite: string | null = null
  let uptime: string | null = null

    if (stats) {
    try {
      const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0)
      const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0)
      const numCpus = stats.cpu_stats?.online_cpus ?? 1
      if (systemDelta > 0 && cpuDelta > 0) {
        cpuPercent = Math.round((cpuDelta / systemDelta) * numCpus * 10000) / 100
      }

        const memUsed = stats.memory_stats?.usage ?? 0
      const memLimit = stats.memory_stats?.limit ?? 0
      if (memUsed > 0) {
        memUsage = formatBytes(memUsed)
        memPercent = memLimit > 0 ? Math.round((memUsed / memLimit) * 10000) / 100 : null
      }

        const ioStats = stats.blkio_stats?.io_service_bytes_recursive
      if (ioStats && ioStats.length > 0) {
        let totalRead = 0, totalWrite = 0
        for (const entry of ioStats) {
          if (entry.op === 'read') totalRead += entry.value ?? 0
          if (entry.op === 'write') totalWrite += entry.value ?? 0
        }
        if (totalRead > 0) diskRead = formatBytes(totalRead)
        if (totalWrite > 0) diskWrite = formatBytes(totalWrite)
      }
    } catch {
    }
  }

    if (info?.State?.StartedAt) {
    uptime = formatUptime(info.State.StartedAt)
  }

    return (cpuPercent !== null || memUsage !== null || uptime !== null)
      ? {cpuPercent, memUsage, memPercent, diskRead, diskWrite, uptime}
      : null
}
