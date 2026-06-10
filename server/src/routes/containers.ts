import {Elysia, t} from 'elysia'
import {authGuard} from '../plugins/auth-guard'
import {getContainer, getContainerStats, listContainers} from '../docker'
import type {LogCollector} from '../log-collector'
import type {StorageAdapter} from '../storage'
import {ServiceResolver} from '../service-resolver'
import {formatBytes, formatUptime} from '../utils'

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

            results.push({
                id: serviceUuid,
                dockerId: c.Id,
                name,
                image: c.Image,
                state: c.State,
                status: c.Status,
                created: c.Created,
                ports: c.Ports,
                watched: collector.isWatching(c.Id),
                stats: null,
            })
        }
        return results
      })
      .get('/:uuid', async ({params}) => {
          const containerId = await resolveContainerId(params.uuid, storage)
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
            watched: collector.isWatching(containerId),
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
      .get('/:uuid/stats', async ({params, status}) => {
          const containerId = await resolveContainerId(params.uuid, storage)
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
          const containerId = await resolveContainerId(params.uuid, storage)
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
          const containerId = await resolveContainerId(params.uuid, storage)
          if (containerId) await collector.unwatchContainer(containerId)
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

async function resolveContainerId(uuid: string, storage: StorageAdapter): Promise<string | null> {
    return storage.getActiveContainerId(uuid)
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
