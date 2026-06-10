import {EventEmitter} from 'events'
import type {Readable} from 'stream'
import type {StorageAdapter} from './storage'
import {parsedLogToEntry} from './storage'
import {listContainers, streamContainerLogs, watchContainerEvents} from './docker'
import {parseLogLine} from './log-parser'
import {ServiceResolver} from './service-resolver'
import {config} from './config'
import {nowISO, toErrorMessage} from './utils'

interface WatchedContainer {
    containerId: string
    containerName: string
    serviceUuid: string
    instanceId: string
    lineNumber: number
    stream: Readable | null
}

interface WatchContainerOptions {
    forceNewInstance?: boolean
    since?: number
}

export class LogCollector {
    private static readonly FLUSH_INTERVAL_MS = 1000
    private static readonly FLUSH_THRESHOLD = 50
    private storage: StorageAdapter
    private resolver: ServiceResolver
    private watched = new Map<string, WatchedContainer>()
    private eventStream: Readable | null = null
    private logBuffer: import('./storage').LogEntry[] = []
    private flushTimer: ReturnType<typeof setInterval> | null = null
    private emitter = new EventEmitter()
    
    constructor(storage: StorageAdapter) {
        this.storage = storage
        this.resolver = new ServiceResolver(storage)
        this.emitter.setMaxListeners(50)
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
        
        try {
            const containers = await listContainers(false)
            for (const container of containers) {
                const name = container.Names?.[0]?.replace(/^\//, '') || container.Id
                const labels: Record<string, string> = container.Labels || {}
                
                let serviceUuid: string
                try {
                    serviceUuid = await this.resolver.resolve(labels, name)
                } catch (err) {
                    console.warn(`Failed to resolve service for ${name}:`, toErrorMessage(err))
                    continue
                }
                
                if (!(await this.storage.isContainerWatched(serviceUuid))) {
                    console.log(`Skipping auto-watch for container: ${name} (previously unwatched)`)
                    continue
                }
                try {
                    await this.watchContainer(container.Id, name, serviceUuid)
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
    
    async watchContainer(
        containerId: string,
        containerName: string,
        serviceUuid: string,
        options: WatchContainerOptions = {},
    ) {
        if (this.watched.has(containerId)) return
        const {forceNewInstance = false, since} = options
        
        if (forceNewInstance) {
            const existing = await this.storage.getActiveInstance(serviceUuid)
            if (existing) {
                await this.storage.stopInstance(existing.id)
            }
        }
        
        let instance = forceNewInstance ? null : await this.storage.getActiveInstance(serviceUuid)
        if (!instance) {
            const instanceId = await this.storage.createInstance(containerId, containerName, serviceUuid)
            instance = {
                id: instanceId,
                serviceUuid,
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
            serviceUuid,
            instanceId: instance.id,
            lineNumber: 0,
            stream: null,
        }
        this.watched.set(containerId, watched)
        await this.storage.setContainerWatched(serviceUuid, true)
        
        await this.startStreaming(watched, since)
    }
    
    async unwatchContainer(containerId: string) {
        const watched = this.watched.get(containerId)
        if (!watched) return
        
        watched.stream?.destroy()
        this.watched.delete(containerId)
        await this.storage.setContainerWatched(watched.serviceUuid, false)
    }
    
    isWatching(containerId: string): boolean {
        return this.watched.has(containerId)
    }
    
    getWatchedContainers(): string[] {
        return Array.from(this.watched.keys())
    }
    
    onLog(callback: (entry: import('./storage').LogEntry) => void): () => void {
        const handler = (entry: import('./storage').LogEntry) => callback(entry)
        this.emitter.on('log', handler)
        return () => this.emitter.off('log', handler)
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
    
    private async startStreaming(watched: WatchedContainer, since?: number) {
        try {
            watched.stream?.destroy()
            
            // Phase 1: fetch historical logs since restart point (follow: false)
            if (since) {
                try {
                    await new Promise<void>((resolve) => {
                        let done = false
                        streamContainerLogs({
                            containerId: watched.containerId,
                            follow: false,
                            since,
                            onLog: (line) => {
                                watched.lineNumber++
                                const parsed = parseLogLine(line)
                                const entry = parsedLogToEntry(
                                    parsed,
                                    watched.serviceUuid,
                                    watched.containerId,
                                    watched.containerName,
                                    watched.instanceId,
                                    watched.lineNumber,
                                )
                                this.logBuffer.push(entry)
                            },
                            onError: () => {
                            },
                            onEnd: () => {
                                if (done) return
                                done = true
                                resolve()
                            },
                        }).then(() => {
                        }).catch(() => {
                            if (!done) {
                                done = true;
                                resolve()
                            }
                        })
                    })
                    if (this.logBuffer.length > 0) {
                        await this.flushBuffer()
                    }
                } catch (err) {
                    console.warn(`Failed to fetch historical logs for ${watched.containerName}:`, toErrorMessage(err))
                }
            }
            
            // Phase 2: start live streaming (tail: 0, from now on)
            const stream = await streamContainerLogs({
                containerId: watched.containerId,
                follow: true,
                tail: 0,
                onLog: async (line) => {
                    watched.lineNumber++
                    const parsed = parseLogLine(line)
                    const entry = parsedLogToEntry(
                        parsed,
                        watched.serviceUuid,
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
    
    private async handleDockerEvent(event: {
        type: string;
        containerId: string;
        containerName: string;
        eventTime: number | null
    }) {
        const watched = this.watched.get(event.containerId)
        
        if (watched) {
            if (event.type === 'die' || event.type === 'kill') {
                await this.storage.stopInstance(watched.instanceId)
                watched.stream?.destroy()
                
                if (!config.retainLogsOnRestart) {
                    await this.storage.deleteLogsByInstance(watched.instanceId)
                }
            }
            
            if (event.type === 'start' || event.type === 'restart') {
                const newInstance = await this.storage.createInstance(event.containerId, event.containerName, watched.serviceUuid)
                watched.instanceId = newInstance
                watched.lineNumber = 0
                const since = this.getReplaySince(event.eventTime)
                await this.startStreaming(watched, since)
            }
        } else if (event.type === 'start' || event.type === 'restart') {
            let serviceUuid: string
            try {
                serviceUuid = await this.resolver.resolveFromContainerId(event.containerId)
            } catch (err) {
                console.warn(`Failed to resolve service for ${event.containerName}:`, toErrorMessage(err))
                return
            }
            
            if (await this.storage.isContainerWatched(serviceUuid)) {
                try {
                    await this.watchContainer(event.containerId, event.containerName, serviceUuid, {
                        forceNewInstance: true,
                        since: this.getReplaySince(event.eventTime),
                    })
                    console.log(`Auto-resumed watching container: ${event.containerName}`)
                } catch (err) {
                    console.warn(`Failed to auto-resume watching ${event.containerName}:`, toErrorMessage(err))
                }
            }
        }
    }
    
    private getReplaySince(eventTime: number | null): number {
        if (typeof eventTime === 'number' && eventTime > 0) {
            return eventTime
        }
        return Math.max(0, Math.floor(Date.now() / 1000) - 10)
    }
    
    private async flushBuffer() {
        if (this.logBuffer.length === 0) return
        const batch = this.logBuffer.splice(0)
        try {
            await this.storage.insertLogs(batch)
            for (const entry of batch) {
                this.emitter.emit('log', entry)
            }
        } catch (err) {
            console.error('[LogCollector] Failed to flush buffer:', err)
        }
    }
}
