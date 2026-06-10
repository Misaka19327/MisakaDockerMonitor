import {Elysia} from 'elysia'
import {authGuard} from '../plugins/auth-guard'
import type {LogCollector} from '../log-collector'
import {config} from '../config'

export function debugRoutes(deps: { collector: LogCollector }) {
    const {collector} = deps

    return new Elysia({prefix: '/api/debug'})
        .use(authGuard)
        .get('/runtime', () => {
            const memory = process.memoryUsage()

            return {
                timestamp: new Date().toISOString(),
                pid: process.pid,
                uptimeSeconds: Math.round(process.uptime()),
                storageType: config.storageType,
                timezone: config.timezone,
                collector: collector.getStats(),
                process: {
                    rssBytes: memory.rss,
                    heapTotalBytes: memory.heapTotal,
                    heapUsedBytes: memory.heapUsed,
                    externalBytes: memory.external,
                    arrayBuffersBytes: memory.arrayBuffers,
                },
            }
        })
}
