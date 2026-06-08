import { Elysia } from 'elysia'
import { getUserFromRequest } from '../auth'
import type { StorageAdapter } from '../storage'
import type { LogCollector } from '../log-collector'
import { isSafeFieldName, parseInteger } from '../utils'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(startedAt: string): string {
  try {
    const start = new Date(startedAt)
    const diffMs = Date.now() - start.getTime()
    if (diffMs < 0) return ''
    const seconds = Math.floor(diffMs / 1000)
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  } catch {
    return ''
  }
}

export function logRoutes(
  storage: StorageAdapter,
  dockerApi?: { getContainer: (id: string) => Promise<any>; getContainerStats: (id: string) => Promise<any> },
  collector?: LogCollector,
) {
  return new Elysia({ prefix: '/api/logs' })
    .onBeforeHandle(async ({ request, set }) => {
      const user = await getUserFromRequest(request)
      if (!user) { set.status = 401; return { error: 'Not authenticated' } }
      return undefined
    })
    .get('/:containerId', async ({ params, query, set }) => {
      const { search, level, startTime, endTime, instanceId, field, fieldValue, limit, offset } = query as any

      if (field && !isSafeFieldName(field)) {
        set.status = 400
        return { error: 'Invalid field name' }
      }

      const result = await storage.queryLogs({
        containerId: params.containerId,
        search,
        level,
        startTime,
        endTime,
        instanceId,
        field,
        fieldValue,
        limit: parseInteger(limit, 200),
        offset: parseInteger(offset, 0),
      })

      let container = null
      if (dockerApi) {
        try {
          const info = await dockerApi.getContainer(params.containerId)
          const state = info.State
          let uptime: string | null = null
          if (state?.StartedAt) {
            uptime = formatUptime(state.StartedAt)
          }

          let cpuPercent: number | null = null
          let memUsage: string | null = null
          let memPercent: number | null = null
          let diskRead: string | null = null
          let diskWrite: string | null = null

          if (state?.Running) {
            try {
              const stats = await dockerApi.getContainerStats(params.containerId)
              if (stats) {
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
              }
            } catch { /* stats not available */ }
          }

          container = {
            id: info.Id,
            name: info.Name?.replace(/^\//, ''),
            image: info.Config?.Image,
            state: state?.Status,
            status: state?.Running ? 'running' : state?.Status,
            created: info.Created,
            ports: info.NetworkSettings?.Ports,
            env: info.Config?.Env,
            watched: collector?.isWatching(params.containerId) ?? false,
            health: state?.Health?.Status ?? null,
            exitCode: state?.ExitCode ?? null,
            pid: state?.Pid ?? null,
            restartCount: info.RestartCount ?? null,
            startedAt: state?.StartedAt ?? null,
            finishedAt: state?.FinishedAt ?? null,
            uptime,
            networks: Object.keys(info.NetworkSettings?.Networks || {}),
            restartPolicy: info.HostConfig?.RestartPolicy?.Name ?? null,
            stats: cpuPercent !== null || memUsage !== null ? {
              cpuPercent,
              memUsage,
              memPercent,
              diskRead,
              diskWrite,
              uptime,
            } : null,
          }
        } catch { /* container may have been removed */ }
      }

      return { ...result, container }
    })
    .get('/:containerId/levels', async ({ params }) => {
      return storage.getDistinctLevels(params.containerId)
    })
    .get('/:containerId/group', async ({ params, query, set }) => {
      const { field, instanceId } = query as any
      if (!field) {
        set.status = 400
        return { error: 'field parameter is required' }
      }
      if (!isSafeFieldName(field)) {
        set.status = 400
        return { error: 'Invalid field name' }
      }

      return storage.groupByField(params.containerId, field, instanceId)
    })
    .get('/:containerId/field-values', async ({ params, query, set }) => {
      const { field } = query as any
      if (!field) {
        set.status = 400
        return { error: 'field parameter is required' }
      }
      if (!isSafeFieldName(field)) {
        set.status = 400
        return { error: 'Invalid field name' }
      }

      return storage.getDistinctFieldValues(params.containerId, field)
    })
    .get('/:containerId/live', async ({ params, set }) => {
      set.headers['content-type'] = 'text/event-stream'
      set.headers['cache-control'] = 'no-cache'
      set.headers['connection'] = 'keep-alive'

      const containerId = params.containerId
      let interval: ReturnType<typeof setInterval> | null = null
      let heartbeat: ReturnType<typeof setInterval> | null = null
      let statusInterval: ReturnType<typeof setInterval> | null = null

      return new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()

          const sendEvent = (data: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          }

          const sendStatusEvent = (data: unknown) => {
            controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(data)}\n\n`))
          }

          let lastId = 0
          interval = setInterval(async () => {
            try {
              const result = await storage.queryLogs({
                containerId,
                limit: 100,
                offset: 0,
              })

              if (result.entries.length > 0) {
                const newEntries = result.entries.filter(e => (e.id || 0) > lastId)
                if (newEntries.length > 0) {
                  const orderedEntries = [...newEntries].sort((a, b) => (a.id || 0) - (b.id || 0))
                  for (const entry of orderedEntries) {
                    sendEvent(entry)
                  }
                  lastId = Math.max(...orderedEntries.map(entry => entry.id || 0))
                }
              }
            } catch {
              // ignore
            }
          }, 2000)

          heartbeat = setInterval(() => {
            controller.enqueue(encoder.encode(`:heartbeat\n\n`))
          }, 15000)

          if (dockerApi) {
            statusInterval = setInterval(async () => {
              try {
                const info = await dockerApi.getContainer(containerId)
                const state = info.State
                let uptime: string | null = null
                if (state?.StartedAt) {
                  const start = new Date(state.StartedAt)
                  const diffMs = Date.now() - start.getTime()
                  if (diffMs >= 0) {
                    const seconds = Math.floor(diffMs / 1000)
                    const days = Math.floor(seconds / 86400)
                    const hours = Math.floor((seconds % 86400) / 3600)
                    const minutes = Math.floor((seconds % 3600) / 60)
                    if (days > 0) uptime = `${days}d ${hours}h`
                    else if (hours > 0) uptime = `${hours}h ${minutes}m`
                    else uptime = `${minutes}m`
                  }
                }
                sendStatusEvent({
                  state: state?.Status,
                  health: state?.Health?.Status ?? null,
                  exitCode: state?.ExitCode ?? null,
                  pid: state?.Pid ?? null,
                  restartCount: info.RestartCount ?? null,
                  startedAt: state?.StartedAt ?? null,
                  finishedAt: state?.FinishedAt ?? null,
                  uptime,
                })
              } catch {
                // container may have been removed
              }
            }, 10000)
          }
        },
        cancel() {
          if (interval) clearInterval(interval)
          if (heartbeat) clearInterval(heartbeat)
          if (statusInterval) clearInterval(statusInterval)
        },
      })
    })
}
