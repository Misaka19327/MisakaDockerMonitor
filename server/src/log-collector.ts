import type {Readable} from 'stream'
import type {StorageAdapter} from './storage'
import {parsedLogToEntry} from './storage'
import {listContainers, streamContainerLogs, watchContainerEvents} from './docker'
import {parseLogLine} from './log-parser'
import {config} from './config'
import {nowISO, toErrorMessage} from './utils'

interface WatchedContainer {
  containerId: string
  containerName: string
  instanceId: string
  lineNumber: number
  stream: Readable | null
}

export class LogCollector {
  private storage: StorageAdapter
  private watched = new Map<string, WatchedContainer>()
  private eventStream: Readable | null = null
  private logBuffer: import('./storage').LogEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private static readonly FLUSH_INTERVAL_MS = 1000
  private static readonly FLUSH_THRESHOLD = 50

  constructor(storage: StorageAdapter) {
    this.storage = storage
  }

  async start() {
    try {
      this.eventStream = await watchContainerEvents((event) => {
        void this.handleDockerEvent(event)
      })
      console.log('Docker event stream connected')
    } catch (err) {
      console.warn('Failed to watch Docker events (non-fatal):', toErrorMessage(err))
    }

    // Auto-discover and watch all currently running containers
    try {
      const containers = await listContainers(false)
      for (const container of containers) {
        const name = container.Names?.[0]?.replace(/^\//, '') || container.Id
        if (!(await this.storage.isContainerWatched(container.Id))) {
          console.log(`Skipping auto-watch for container: ${name} (previously unwatched)`)
          continue
        }
        try {
          await this.watchContainer(container.Id, name, true)
          console.log(`Auto-watching container: ${name}`)
        } catch (err) {
          console.warn(`Failed to auto-watch container ${name}:`, toErrorMessage(err))
        }
      }
      console.log(`Auto-discovered ${containers.length} running containers`)
    } catch (err) {
      console.warn('Failed to list running containers (non-fatal):', toErrorMessage(err))
    }

    this.flushTimer = setInterval(() => {
      void this.flushBuffer()
    }, LogCollector.FLUSH_INTERVAL_MS)
  }

  async watchContainer(containerId: string, containerName: string, forceNewInstance = false) {
    if (this.watched.has(containerId)) return

    // If forcing new instance, stop any stale "running" instance from a previous server run
    if (forceNewInstance) {
      const existing = await this.storage.getActiveInstance(containerId)
      if (existing) {
        await this.storage.stopInstance(existing.id)
      }
    }

    // Get or create instance
    let instance = forceNewInstance ? null : await this.storage.getActiveInstance(containerId)
    if (!instance) {
      const instanceId = await this.storage.createInstance(containerId, containerName)
      instance = {
        id: instanceId,
        containerId,
        containerName,
        startedAt: nowISO(),
        stoppedAt: null,
        status: 'running',
      }
    }

    const watched: WatchedContainer = {
      containerId,
      containerName,
      instanceId: instance.id,
      lineNumber: 0,
      stream: null,
    }
    this.watched.set(containerId, watched)
    await this.storage.setContainerWatched(containerId, true)

    // Start streaming logs
    await this.startStreaming(watched)
  }

  async unwatchContainer(containerId: string) {
    const watched = this.watched.get(containerId)
    if (!watched) return

    watched.stream?.destroy()
    this.watched.delete(containerId)
    await this.storage.setContainerWatched(containerId, false)
  }

  isWatching(containerId: string): boolean {
    return this.watched.has(containerId)
  }

  getWatchedContainers(): string[] {
    return Array.from(this.watched.keys())
  }

  private async startStreaming(watched: WatchedContainer) {
    try {
      watched.stream?.destroy()

      const stream = await streamContainerLogs({
        containerId: watched.containerId,
        follow: true,
        tail: 0,
        onLog: async (line) => {
          watched.lineNumber++
          const parsed = parseLogLine(line)
          const entry = parsedLogToEntry(
              parsed,
              watched.containerId,
              watched.containerName,
              watched.instanceId,
              watched.lineNumber,
          )
          this.logBuffer.push(entry)
          if (this.logBuffer.length >= LogCollector.FLUSH_THRESHOLD) {
            await this.flushBuffer()
          }
        },
        onError: (err) => {
          console.error(`Log stream error for ${watched.containerName}:`, err.message)
        },
        onEnd: () => {
          console.log(`Log stream ended for ${watched.containerName}`)
        },
      })

      watched.stream = stream
    } catch (err) {
      console.error(`Failed to start log stream for ${watched.containerName}:`, toErrorMessage(err))
    }
  }

  private async handleDockerEvent(event: { type: string; containerId: string; containerName: string }) {
    const watched = this.watched.get(event.containerId)
    if (!watched) return

    if (event.type === 'die' || event.type === 'kill') {
      // Container stopped
      await this.storage.stopInstance(watched.instanceId)
      watched.stream?.destroy()

      if (!config.retainLogsOnRestart) {
        await this.storage.deleteLogsByInstance(watched.instanceId)
      }
    }

    if (event.type === 'start' || event.type === 'restart') {
      // Container started - create new instance
      const newInstance = await this.storage.createInstance(event.containerId, event.containerName)
      watched.instanceId = newInstance
      watched.lineNumber = 0
      await this.startStreaming(watched)
    }
  }

  private async flushBuffer() {
    if (this.logBuffer.length === 0) return
    const batch = this.logBuffer.splice(0)
    try {
      await this.storage.insertLogs(batch)
    } catch (err) {
      console.error('[LogCollector] Failed to flush buffer:', err)
    }
  }

  async stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flushBuffer()
    for (const [, watched] of this.watched) {
      watched.stream?.destroy()
      await this.storage.stopInstance(watched.instanceId)
    }
    this.watched.clear()
    this.eventStream?.destroy()
  }
}
