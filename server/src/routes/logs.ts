import {Elysia, t} from 'elysia'
import {authGuard} from '../plugins/auth-guard'
import {getContainer, getContainerStats} from '../docker'
import type {LogCollector} from '../log-collector'
import type {StorageAdapter} from '../storage'
import {formatBytes, formatUptime, isSafeFieldName, parseInteger} from '../utils'

export function logRoutes(deps: { storage: StorageAdapter; collector: LogCollector }) {
    const {storage, collector} = deps
    
    return new Elysia({prefix: '/api/logs'})
        .use(authGuard)
        .get('/:containerId', async ({params, query, status}) => {
            const {search, level, startTime, endTime, instanceId, field, fieldValue, limit, offset} = query
            
            if (field && !isSafeFieldName(field)) {
                return status(400, {error: 'Invalid field name'})
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
            try {
                container = await getContainerDetail(params.containerId, collector)
            } catch { /* container may have been removed */
            }
            
            return {...result, container}
        }, {
            params: t.Object({containerId: t.String()}),
            query: t.Object({
                search: t.Optional(t.String()),
                level: t.Optional(t.String()),
                startTime: t.Optional(t.String()),
                endTime: t.Optional(t.String()),
                instanceId: t.Optional(t.String()),
                field: t.Optional(t.String()),
                fieldValue: t.Optional(t.String()),
                limit: t.Optional(t.Numeric()),
                offset: t.Optional(t.Numeric()),
            }),
        })
        .get('/:containerId/levels', async ({params}) => {
            return storage.getDistinctLevels(params.containerId)
        }, {
            params: t.Object({containerId: t.String()}),
        })
        .get('/:containerId/group', async ({params, query, status}) => {
            if (!query.field) {
                return status(400, {error: 'field parameter is required'})
            }
            if (!isSafeFieldName(query.field)) {
                return status(400, {error: 'Invalid field name'})
            }
            
            return storage.groupByField(params.containerId, query.field, query.instanceId)
        }, {
            params: t.Object({containerId: t.String()}),
            query: t.Object({
                field: t.String(),
                instanceId: t.Optional(t.String()),
            }),
        })
        .get('/:containerId/field-values', async ({params, query, status}) => {
            if (!query.field) {
                return status(400, {error: 'field parameter is required'})
            }
            if (!isSafeFieldName(query.field)) {
                return status(400, {error: 'Invalid field name'})
            }
            
            return storage.getDistinctFieldValues(params.containerId, query.field)
        }, {
            params: t.Object({containerId: t.String()}),
            query: t.Object({
                field: t.String(),
            }),
        })
        .get('/:containerId/live', async ({params, set}) => {
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
                                const newEntries = result.entries.filter((e: any) => (e.id || 0) > lastId)
                                if (newEntries.length > 0) {
                                    const orderedEntries = [...newEntries].sort((a: any, b: any) => (a.id || 0) - (b.id || 0))
                                    for (const entry of orderedEntries) {
                                        sendEvent(entry)
                                    }
                                    lastId = Math.max(...orderedEntries.map((entry: any) => entry.id || 0))
                                }
                            }
                        } catch {
                            // ignore
                        }
                    }, 2000)
                    
                    heartbeat = setInterval(() => {
                        controller.enqueue(encoder.encode(`:heartbeat\n\n`))
                    }, 15000)
                    
                    statusInterval = setInterval(async () => {
                        try {
                            const info = await getContainer(containerId)
                            const state = info.State
                            let uptime: string | null = null
                            if (state?.StartedAt) {
                                uptime = formatUptime(state.StartedAt)
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
                },
                cancel() {
                    if (interval) clearInterval(interval)
                    if (heartbeat) clearInterval(heartbeat)
                    if (statusInterval) clearInterval(statusInterval)
                },
            })
        }, {
            params: t.Object({containerId: t.String()}),
        })
}

async function getContainerDetail(containerId: string, collector: { isWatching: (id: string) => boolean }) {
    const info = await getContainer(containerId)
    const state = info.State
    const uptime = state?.StartedAt ? formatUptime(state.StartedAt) : null
    
    let cpuPercent: number | null = null
    let memUsage: string | null = null
    let memPercent: number | null = null
    let diskRead: string | null = null
    let diskWrite: string | null = null
    
    if (state?.Running) {
        try {
            const stats = await getContainerStats(containerId)
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
        stats: cpuPercent !== null || memUsage !== null ? {
            cpuPercent,
            memUsage,
            memPercent,
            diskRead,
            diskWrite,
            uptime,
        } : null,
    }
}
