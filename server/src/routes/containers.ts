import {Elysia, t} from 'elysia'
import {authGuard} from '../plugins/auth-guard'
import {getContainer, getContainerStats, listContainers} from '../docker'
import type {LogCollector} from '../log-collector'
import type {StorageAdapter} from '../storage'
import {formatBytes, formatUptime} from '../utils'

export function containerRoutes(deps: { storage: StorageAdapter; collector: LogCollector }) {
  const {storage, collector} = deps

  return new Elysia({prefix: '/api/containers'})
      .use(authGuard)
      .get('/', async () => {
        const containers = await listContainers(true) as any[]
        const running = containers.filter((c: any) => c.State === 'running')
        const statsMap: Record<string, any> = {}
        const infoMap: Record<string, any> = {}
        await Promise.all(running.map(async (c: any) => {
          try {
            statsMap[c.Id] = await getContainerStats(c.Id)
          } catch { /* ignore */
          }
          try {
            infoMap[c.Id] = await getContainer(c.Id)
          } catch { /* ignore */
          }
        }))
        return containers.map((c: any) => ({
          id: c.Id,
          name: c.Names?.[0]?.replace(/^\//, '') || '',
          image: c.Image,
          state: c.State,
          status: c.Status,
          created: c.Created,
          ports: c.Ports,
          watched: collector.isWatching(c.Id),
          stats: extractStats(statsMap[c.Id], infoMap[c.Id]),
        }))
      })
      .get('/:id', async ({params}) => {
        const info = await getContainer(params.id)
        const state = info.State
        const uptime = state?.StartedAt ? formatUptime(state.StartedAt) : null

        let stats: ReturnType<typeof extractStats> = null
        if (state?.Running) {
          try {
            const dockerStats = await getContainerStats(params.id)
            stats = extractStats(dockerStats, info)
          } catch { /* stats not available */
          }
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
          stats,
        }
      }, {
        params: t.Object({id: t.String()}),
      })
      .get('/:id/stats', async ({params, status}) => {
        try {
          return await getContainerStats(params.id)
        } catch (err: any) {
          return status(500, {error: 'Failed to get stats', details: err.message})
        }
      }, {
        params: t.Object({id: t.String()}),
      })
      .post('/:id/watch', async ({params, status}) => {
        try {
          const info = await getContainer(params.id)
          const name = info.Name?.replace(/^\//, '') || params.id
          await collector.watchContainer(params.id, name)
          return {success: true, message: `Now watching container ${name}`}
        } catch (err: any) {
          return status(500, {error: 'Failed to watch container', details: err.message})
        }
      }, {
        params: t.Object({id: t.String()}),
      })
      .delete('/:id/watch', async ({params}) => {
        await collector.unwatchContainer(params.id)
        return {success: true, message: 'Stopped watching container'}
      }, {
        params: t.Object({id: t.String()}),
      })
      .get('/:id/instances', async ({params}) => {
        return storage.getInstances(params.id)
      }, {
        params: t.Object({id: t.String()}),
      })
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
    } catch { /* ignore parse errors */
    }
  }

  if (info?.State?.StartedAt) {
    uptime = formatUptime(info.State.StartedAt)
  }

  return (cpuPercent !== null || memUsage !== null || uptime !== null)
      ? {cpuPercent, memUsage, memPercent, diskRead, diskWrite, uptime}
      : null
}
