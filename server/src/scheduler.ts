import { Elysia } from 'elysia'
import { cron } from '@elysia/cron'
import type { StorageAdapter } from './storage'
import { daysAgoISO } from './utils'
import { config } from './config'

async function runCleanup(storage: StorageAdapter) {
  try {
    const cutoff = daysAgoISO(3)
    console.log(`[Cleanup] Starting daily cleanup, cutoff: ${cutoff}`)
    const logCount = await storage.deleteLogsBefore(cutoff)
    const instanceCount = await storage.deleteStoppedInstancesWithNoLogs()
    console.log(`[Cleanup] Deleted ${logCount} log entries, ${instanceCount} empty stopped instances`)
    await storage.checkpoint()
    await storage.vacuum()
    console.log('[Cleanup] Checkpoint and vacuum completed')
  } catch (err) {
    console.error('[Cleanup] Error during cleanup:', err)
  }
}

export const cleanupPlugin = (storage: StorageAdapter) => {
  console.log(`[Cleanup] Daily cleanup scheduled at midnight (${config.timezone})`)

  return new Elysia()
    .use(
      cron({
        name: 'cleanup',
        pattern: '0 0 * * *',
        timezone: config.timezone,
        async run() {
          await runCleanup(storage)
        }
      })
    )
}
