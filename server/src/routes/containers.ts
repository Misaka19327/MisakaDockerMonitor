import { Elysia } from 'elysia'
import { getUserFromRequest } from '../auth'
import { listContainers, getContainer, getContainerStats } from '../docker'
import type { LogCollector } from '../log-collector'
import type { StorageAdapter } from '../storage'

export function containerRoutes(collector: LogCollector, storage: StorageAdapter) {
  return new Elysia({ prefix: '/api/containers' })
    .onBeforeHandle(async ({ request, set }) => {
      const user = await getUserFromRequest(request)
      if (!user) { set.status = 401; return { error: 'Not authenticated' } }
      return undefined // continue
    })
    .get('/', async ({ set }) => {
      try {
        const containers = await listContainers(true) as any[]
        const running = containers.filter((c: any) => c.State === 'running')
        const statsMap: Record<string, any> = {}
        const infoMap: Record<string, any> = {}
        await Promise.all(running.map(async (c: any) => {
          try { statsMap[c.Id] = await getContainerStats(c.Id) } catch { /* ignore */ }
          try { infoMap[c.Id] = await getContainer(c.Id) } catch { /* ignore */ }
        }))
        return containers.map((c: any) => {
          const stats = statsMap[c.Id]
          const info = infoMap[c.Id]
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
            } catch { /* ignore parse errors */ }
          }

          if (info?.State?.StartedAt) {
            uptime = formatUptime(info.State.StartedAt)
          }

          return {
            id: c.Id,
            name: c.Names?.[0]?.replace(/^\//, '') || '',
            image: c.Image,
            state: c.State,
            status: c.Status,
            created: c.Created,
            ports: c.Ports,
            watched: collector.isWatching(c.Id),
            stats: cpuPercent !== null || memUsage !== null || uptime !== null ? {
              cpuPercent,
              memUsage,
              memPercent,
              diskRead,
              diskWrite,
              uptime,
            } : null,
          }
        })
      } catch (err: any) {
        set.status = 500
        return { error: 'Failed to list containers', details: err.message }
      }
    })
    .get('/:id', async ({ params, set }) => {
      try {
        const info = await getContainer(params.id)
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
            const stats = await getContainerStats(params.id)
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

        return {
          id: info.Id,
          name: info.Name?.replace(/^\//, ''),
          image: info.Config?.Image,
          state: state?.Status,
          status: state?.Running ? 'running' : state?.Status,
          created: info.Created,
          ports: info.NetworkSettings?.Ports,
          env: info.Config?.Env,
          watched: collector.isWatching(params.id),
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
      } catch (err: any) {
        set.status = 404
        return { error: 'Container not found', details: err.message }
      }
    })
    .get('/:id/stats', async ({ params, set }) => {
      try {
        const stats = await getContainerStats(params.id)
        return stats
      } catch (err: any) {
        set.status = 500
        return { error: 'Failed to get stats', details: err.message }
      }
    })
    .post('/:id/watch', async ({ params, set }) => {
      try {
        const info = await getContainer(params.id)
        const name = info.Name?.replace(/^\//, '') || params.id
        await collector.watchContainer(params.id, name)
        return { success: true, message: `Now watching container ${name}` }
      } catch (err: any) {
        set.status = 500
        return { error: 'Failed to watch container', details: err.message }
      }
    })
    .delete('/:id/watch', async ({ params }) => {
      await collector.unwatchContainer(params.id)
      return { success: true, message: 'Stopped watching container' }
    })
    .get('/:id/instances', async ({ params }) => {
      const instances = await storage.getInstances(params.id)
      return instances
    })
}

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
