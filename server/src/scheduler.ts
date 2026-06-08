import type { StorageAdapter } from './storage'
import { daysAgoISO, msUntilNextMidnight } from './utils'

export function startCleanupScheduler(storage: StorageAdapter): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let interval: ReturnType<typeof setInterval> | null = null
  let stopped = false

  async function runCleanup() {
    if (stopped) return
    try {
      const cutoff = daysAgoISO(3)
      console.log(`[Cleanup] Starting daily cleanup, cutoff: ${cutoff}`)
      const logCount = await storage.deleteLogsBefore(cutoff)
      const instanceCount = await storage.deleteStoppedInstancesWithNoLogs()
      console.log(`[Cleanup] Deleted ${logCount} log entries, ${instanceCount} empty stopped instances`)
    } catch (err) {
      console.error('[Cleanup] Error during cleanup:', err)
    }
  }

  const msToMidnight = msUntilNextMidnight()
  console.log(`[Cleanup] First cleanup scheduled in ${Math.round(msToMidnight / 60000)} minutes`)

  timer = setTimeout(() => {
    void runCleanup()
    interval = setInterval(() => {
      void runCleanup()
    }, 24 * 60 * 60 * 1000)
  }, msToMidnight)

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (interval) clearInterval(interval)
  }
}
