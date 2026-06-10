import {EventEmitter} from 'events'
import type {Readable} from 'stream'
import type {StorageAdapter} from './storage'
import {listContainers, streamContainerLogs, watchContainerEvents} from './docker'
import {ServiceResolver} from './service-resolver'
import {config} from './config'
import {nowISO, toErrorMessage} from './utils'
import type {WriterInboundMessage, WriterOutboundMessage} from './log-writer-protocol'
import type {ParseCandidate, ParserInboundMessage, ParserOutboundMessage} from './log-parser-protocol'
import {rawLogToEntry} from './storage'
import type {StorageWorkerEnv} from './storage-worker-env'

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

interface DockerEvent {
    type: string
    containerId: string
    containerName: string
    eventTime: number | null
}

interface PendingWriteBatch {
    batchId: number
    entries: import('./storage').LogEntry[]
}

interface PendingParseBatch {
    batchId: number
    entries: ParseCandidate[]
}

interface PendingBackfillBatch {
    batchId: number
    patches: import('./storage').ParsedLogPatch[]
}

export interface CollectorStats {
    startedAt: string
    watchedContainers: number
    bufferedEntries: number
    maxBufferedEntries: number
    droppedEntries: number
    queuedWriteEntries: number
    maxQueuedWriteEntries: number
    pendingWriteBatches: number
    queuedParseEntries: number
    maxQueuedParseEntries: number
    pendingParseBatches: number
    queuedBackfillEntries: number
    maxQueuedBackfillEntries: number
    pendingBackfillBatches: number
    parseMode: 'active' | 'degraded'
    droppedParseEntries: number
    totalLinesReceived: number
    totalEntriesInserted: number
    totalEntriesParsed: number
    totalEntriesBroadcast: number
    totalFlushes: number
    totalFlushErrors: number
    totalParseBatches: number
    totalParseErrors: number
    lastFlushStartedAt: string | null
    lastFlushFinishedAt: string | null
    lastFlushDurationMs: number | null
}

export class LogCollector {
    private static readonly FLUSH_INTERVAL_MS = 250
    private static readonly FLUSH_THRESHOLD = 500
    private static readonly MAX_FLUSH_BATCH_SIZE = 1000
    private static readonly MAX_BUFFER_ENTRIES = 20000
    private static readonly MAX_PARSE_BATCH_SIZE = 500
    private static readonly MAX_PARSE_QUEUE_ENTRIES = 10000
    private static readonly MAX_BACKFILL_QUEUE_ENTRIES = 10000
    private static readonly PARSE_DEGRADE_WRITE_THRESHOLD = 15000
    private static readonly PARSE_RECOVER_WRITE_THRESHOLD = 5000
    private static readonly PARSE_DEGRADE_BUFFER_THRESHOLD = 5000
    private static readonly PARSE_RECOVER_BUFFER_THRESHOLD = 1000
    private static readonly RESUME_DEBOUNCE_MS = 1500
    private storage: StorageAdapter
    private resolver: ServiceResolver
    private watched = new Map<string, WatchedContainer>()
    private eventStream: Readable | null = null
    private logBuffer: import('./storage').LogEntry[] = []
    private flushTimer: ReturnType<typeof setInterval> | null = null
    private emitter = new EventEmitter()
    private flushInFlight: Promise<void> | null = null
    private flushRequested = false
    private pendingWriteBatches: PendingWriteBatch[] = []
    private inFlightWriteBatch: PendingWriteBatch | null = null
    private nextBatchId = 1
    private queuedWriteEntries = 0
    private maxQueuedWriteEntries = 0
    private writer: Worker | null = null
    private writerReady: Promise<void> | null = null
    private resolveWriterReady: (() => void) | null = null
    private rejectWriterReady: ((reason?: unknown) => void) | null = null
    private writerClosed: Promise<void> | null = null
    private resolveWriterClosed: (() => void) | null = null
    private parser: Worker | null = null
    private parserReady: Promise<void> | null = null
    private resolveParserReady: (() => void) | null = null
    private rejectParserReady: ((reason?: unknown) => void) | null = null
    private parserClosed: Promise<void> | null = null
    private resolveParserClosed: (() => void) | null = null
    private pendingParseBatches: PendingParseBatch[] = []
    private inFlightParseBatch: PendingParseBatch | null = null
    private pendingBackfillBatches: PendingBackfillBatch[] = []
    private inFlightBackfillBatch: PendingBackfillBatch | null = null
    private nextBackfillBatchId = 1_000_000_000
    private nextParseBatchId = 1
    private queuedParseEntries = 0
    private maxQueuedParseEntries = 0
    private queuedBackfillEntries = 0
    private maxQueuedBackfillEntries = 0
    private parseMode: 'active' | 'degraded' = 'active'
    private pendingResumeTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private pendingResumeEvents = new Map<string, DockerEvent>()
    private readonly stats: CollectorStats = {
        startedAt: nowISO(),
        watchedContainers: 0,
        bufferedEntries: 0,
        maxBufferedEntries: 0,
        droppedEntries: 0,
        queuedWriteEntries: 0,
        maxQueuedWriteEntries: 0,
        pendingWriteBatches: 0,
        queuedParseEntries: 0,
        maxQueuedParseEntries: 0,
        pendingParseBatches: 0,
        queuedBackfillEntries: 0,
        maxQueuedBackfillEntries: 0,
        pendingBackfillBatches: 0,
        parseMode: 'active',
        droppedParseEntries: 0,
        totalLinesReceived: 0,
        totalEntriesInserted: 0,
        totalEntriesParsed: 0,
        totalEntriesBroadcast: 0,
        totalFlushes: 0,
        totalFlushErrors: 0,
        totalParseBatches: 0,
        totalParseErrors: 0,
        lastFlushStartedAt: null,
        lastFlushFinishedAt: null,
        lastFlushDurationMs: null,
    }
    
    constructor(storage: StorageAdapter) {
        this.storage = storage
        this.resolver = new ServiceResolver(storage)
        this.emitter.setMaxListeners(50)
    }
    
    async start() {
        await this.startWriter()
        await this.startParser()

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
            let resumedCount = 0
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
                    continue
                }

                try {
                    await this.watchContainer(container.Id, name, serviceUuid)
                    resumedCount++
                } catch (err) {
                    console.warn(`Failed to resume watching container ${name}:`, toErrorMessage(err))
                }
            }
            console.log(`Discovered ${containers.length} running containers`)
            console.log(`Restored monitoring for ${resumedCount} running containers`)
        } catch (err) {
            console.warn('Failed to scan running containers (non-fatal):', toErrorMessage(err))
        }
        
        this.flushTimer = setInterval(() => {
            void this.requestFlush()
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

    getStats(): CollectorStats {
        return {
            ...this.stats,
            watchedContainers: this.watched.size,
            bufferedEntries: this.logBuffer.length,
            maxBufferedEntries: Math.max(this.stats.maxBufferedEntries, this.logBuffer.length),
            queuedWriteEntries: this.queuedWriteEntries,
            maxQueuedWriteEntries: this.maxQueuedWriteEntries,
            pendingWriteBatches: this.pendingWriteBatches.length + (this.inFlightWriteBatch ? 1 : 0),
            queuedParseEntries: this.queuedParseEntries,
            maxQueuedParseEntries: this.maxQueuedParseEntries,
            pendingParseBatches: this.pendingParseBatches.length + (this.inFlightParseBatch ? 1 : 0),
            queuedBackfillEntries: this.queuedBackfillEntries,
            maxQueuedBackfillEntries: this.maxQueuedBackfillEntries,
            pendingBackfillBatches: this.pendingBackfillBatches.length + (this.inFlightBackfillBatch ? 1 : 0),
            parseMode: this.parseMode,
        }
    }
    
    onEntries(callback: (entries: import('./storage').LogEntry[]) => void): () => void {
        const handler = (entries: import('./storage').LogEntry[]) => callback(entries)
        this.emitter.on('entries', handler)
        return () => this.emitter.off('entries', handler)
    }
    
    async stop() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer)
            this.flushTimer = null
        }
        for (const timer of this.pendingResumeTimers.values()) {
            clearTimeout(timer)
        }
        this.pendingResumeTimers.clear()
        this.pendingResumeEvents.clear()
        await this.requestFlush()
        await this.drainWriterQueue()
        await this.drainParserQueue()
        await this.drainWriterQueue()
        for (const [, watched] of this.watched) {
            watched.stream?.destroy()
            await this.storage.stopInstance(watched.instanceId)
        }
        this.watched.clear()
        this.eventStream?.destroy()
        await this.stopParser()
        await this.stopWriter()
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
                                this.stats.totalLinesReceived++
                                this.enqueueEntry(watched, line)
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
                        await this.requestFlush()
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
                    this.stats.totalLinesReceived++
                    this.enqueueEntry(watched, line)
                    if (this.logBuffer.length >= LogCollector.FLUSH_THRESHOLD) {
                        await this.requestFlush()
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
    
    private async handleDockerEvent(event: DockerEvent) {
        const watched = this.watched.get(event.containerId)
        
        if (watched) {
            if (event.type === 'die' || event.type === 'kill') {
                await this.storage.stopInstance(watched.instanceId)
                watched.stream?.destroy()
                this.watched.delete(event.containerId)
                
                if (!config.retainLogsOnRestart) {
                    await this.storage.deleteLogsByInstance(watched.instanceId)
                }
            }
            
            if (event.type === 'start' || event.type === 'restart') {
                this.scheduleResume(event)
            }
        } else if (event.type === 'start' || event.type === 'restart') {
            this.scheduleResume(event)
        }
    }
    
    private getReplaySince(eventTime: number | null): number {
        if (typeof eventTime === 'number' && eventTime > 0) {
            return eventTime
        }
        return Math.max(0, Math.floor(Date.now() / 1000) - 10)
    }
    
    private enqueueEntry(watched: WatchedContainer, line: string) {
        if (this.logBuffer.length >= LogCollector.MAX_BUFFER_ENTRIES) {
            this.stats.droppedEntries++
            return
        }

        const entry = rawLogToEntry(
            line,
            watched.serviceUuid,
            watched.containerId,
            watched.containerName,
            watched.instanceId,
            watched.lineNumber,
        )
        this.logBuffer.push(entry)
        this.captureBufferWatermark()
    }

    private async requestFlush() {
        this.flushRequested = true
        if (this.flushInFlight) {
            return this.flushInFlight
        }

        this.flushInFlight = this.flushLoop().finally(() => {
            this.flushInFlight = null
        })

        return this.flushInFlight
    }

    private async flushLoop() {
        while (this.flushRequested || this.logBuffer.length >= LogCollector.FLUSH_THRESHOLD) {
            this.flushRequested = false
            if (this.logBuffer.length === 0) {
                break
            }

            const batch = this.logBuffer.splice(0, LogCollector.MAX_FLUSH_BATCH_SIZE)
            this.queueWriteBatch(batch)
        }
    }

    private queueWriteBatch(batch: import('./storage').LogEntry[]) {
        if (batch.length === 0) return
        this.pendingWriteBatches.push({
            batchId: this.nextBatchId++,
            entries: batch,
        })
        this.queuedWriteEntries += batch.length
        if (this.queuedWriteEntries > this.maxQueuedWriteEntries) {
            this.maxQueuedWriteEntries = this.queuedWriteEntries
        }
        this.refreshParseMode()
        void this.dispatchNextWriterJob()
    }

    private captureBufferWatermark() {
        if (this.logBuffer.length > this.stats.maxBufferedEntries) {
            this.stats.maxBufferedEntries = this.logBuffer.length
        }
    }

    private async startWriter() {
        this.writerReady = new Promise<void>((resolve, reject) => {
            this.resolveWriterReady = resolve
            this.rejectWriterReady = reject
        })
        this.writerClosed = new Promise<void>((resolve) => {
            this.resolveWriterClosed = resolve
        })

        this.writer = new Worker(new URL('./log-writer-worker.ts', import.meta.url).href, {type: 'module'})
        this.writer.onmessage = (event: MessageEvent<WriterOutboundMessage>) => {
            void this.handleWriterMessage(event.data)
        }
        this.writer.onerror = (event: ErrorEvent) => {
            const message = event.message || 'Writer worker failed'
            console.error('[LogCollector] Writer worker error:', message)
            this.rejectWriterReady?.(new Error(message))
        }
        this.writer.postMessage({type: 'init', env: this.buildWorkerEnv()} satisfies WriterInboundMessage)

        await this.writerReady
    }

    private async stopWriter() {
        if (!this.writer) {
            return
        }

        this.writer.postMessage({type: 'close'} satisfies WriterInboundMessage)
        await this.writerClosed
        this.writer.terminate()
        this.writer = null
        this.writerReady = null
        this.writerClosed = null
        this.resolveWriterReady = null
        this.rejectWriterReady = null
        this.resolveWriterClosed = null
    }

    private async startParser() {
        this.parserReady = new Promise<void>((resolve, reject) => {
            this.resolveParserReady = resolve
            this.rejectParserReady = reject
        })
        this.parserClosed = new Promise<void>((resolve) => {
            this.resolveParserClosed = resolve
        })

        this.parser = new Worker(new URL('./log-parser-worker.ts', import.meta.url).href, {type: 'module'})
        this.parser.onmessage = (event: MessageEvent<ParserOutboundMessage>) => {
            void this.handleParserMessage(event.data)
        }
        this.parser.onerror = (event: ErrorEvent) => {
            const message = event.message || 'Parser worker failed'
            console.error('[LogCollector] Parser worker error:', message)
            this.rejectParserReady?.(new Error(message))
        }
        await this.parserReady
    }

    private async stopParser() {
        if (!this.parser) {
            return
        }

        this.parser.postMessage({type: 'close'} satisfies ParserInboundMessage)
        await this.parserClosed
        this.parser.terminate()
        this.parser = null
        this.parserReady = null
        this.parserClosed = null
        this.resolveParserReady = null
        this.rejectParserReady = null
        this.resolveParserClosed = null
    }

    private async dispatchNextWriterJob() {
        if (!this.writer || this.inFlightWriteBatch || this.inFlightBackfillBatch) {
            return
        }

        if (this.writerReady) {
            await this.writerReady
        }

        const batch = this.pendingWriteBatches.shift()
        if (batch && this.writer) {
            this.inFlightWriteBatch = batch
            this.stats.lastFlushStartedAt = nowISO()
            this.writer.postMessage({
                type: 'write',
                batchId: batch.batchId,
                entries: batch.entries,
            } satisfies WriterInboundMessage)
            return
        }

        const backfillBatch = this.pendingBackfillBatches.shift()
        if (!backfillBatch || !this.writer) {
            return
        }

        this.inFlightBackfillBatch = backfillBatch
        this.writer.postMessage({
            type: 'backfill',
            batchId: backfillBatch.batchId,
            patches: backfillBatch.patches,
        } satisfies WriterInboundMessage)
    }

    private async handleWriterMessage(message: WriterOutboundMessage) {
        if (message.type === 'ready') {
            this.resolveWriterReady?.()
            this.resolveWriterReady = null
            this.rejectWriterReady = null
            return
        }

        if (message.type === 'closed') {
            this.resolveWriterClosed?.()
            this.resolveWriterClosed = null
            return
        }

        if (message.type === 'fatal') {
            console.error('[LogCollector] Writer worker fatal:', message.error)
            this.rejectWriterReady?.(new Error(message.error))
            return
        }

        const writeBatch = this.inFlightWriteBatch
        if (writeBatch && writeBatch.batchId === message.batchId) {
            this.inFlightWriteBatch = null
            this.stats.lastFlushFinishedAt = nowISO()

            if (message.type === 'write-error') {
                this.stats.totalFlushErrors++
                this.stats.lastFlushDurationMs = null
                console.error('[LogCollector] Failed to write batch:', message.error)
                this.pendingWriteBatches.unshift(writeBatch)
                await Bun.sleep(250)
                await this.dispatchNextWriterJob()
                return
            }

            if (message.type !== 'written') {
                return
            }

            this.queuedWriteEntries = Math.max(0, this.queuedWriteEntries - message.entries.length)
            this.stats.totalFlushes++
            this.stats.totalEntriesInserted += message.entries.length
            this.stats.totalEntriesBroadcast += message.entries.length
            this.refreshParseMode()
            this.queueParseEntries(message.entries)
            this.stats.lastFlushDurationMs = writeBatch.entries.length > 0 && this.stats.lastFlushStartedAt
                ? Math.round((Date.now() - new Date(this.stats.lastFlushStartedAt).getTime()) * 100) / 100
                : null
            this.emitter.emit('entries', message.entries)

            await this.dispatchNextWriterJob()
            return
        }

        const backfillBatch = this.inFlightBackfillBatch
        if (!backfillBatch || backfillBatch.batchId !== message.batchId) {
            return
        }

        this.inFlightBackfillBatch = null

        if (message.type === 'backfill-error') {
            this.queuedBackfillEntries = Math.max(0, this.queuedBackfillEntries - backfillBatch.patches.length)
            this.stats.totalParseErrors++
            this.stats.droppedParseEntries += backfillBatch.patches.length
            console.error('[LogCollector] Failed to backfill parsed batch:', message.error)
            this.refreshParseMode()
            await this.dispatchNextWriterJob()
            return
        }

        if (message.type !== 'backfilled') {
            return
        }

        this.queuedBackfillEntries = Math.max(0, this.queuedBackfillEntries - backfillBatch.patches.length)
        this.refreshParseMode()
        await this.dispatchNextWriterJob()
    }

    private async drainWriterQueue() {
        while (
            this.pendingWriteBatches.length > 0
            || this.pendingBackfillBatches.length > 0
            || this.inFlightWriteBatch
            || this.inFlightBackfillBatch
        ) {
            await Bun.sleep(50)
        }
    }

    private queueParseEntries(entries: import('./storage').LogEntry[]) {
        const candidates = entries
            .filter((entry) => entry.id != null && this.shouldAsyncParse(entry.rawContent))
            .map((entry) => ({id: entry.id!, rawContent: entry.rawContent}))

        if (candidates.length === 0) {
            return
        }

        this.refreshParseMode()
        if (this.parseMode === 'degraded') {
            this.stats.droppedParseEntries += candidates.length
            return
        }

        for (let index = 0; index < candidates.length; index += LogCollector.MAX_PARSE_BATCH_SIZE) {
            const batchEntries = candidates.slice(index, index + LogCollector.MAX_PARSE_BATCH_SIZE)
            if (this.queuedParseEntries + batchEntries.length > LogCollector.MAX_PARSE_QUEUE_ENTRIES) {
                this.parseMode = 'degraded'
                this.stats.droppedParseEntries += candidates.length - index
                this.stats.parseMode = this.parseMode
                return
            }

            this.pendingParseBatches.push({
                batchId: this.nextParseBatchId++,
                entries: batchEntries,
            })
            this.queuedParseEntries += batchEntries.length
            if (this.queuedParseEntries > this.maxQueuedParseEntries) {
                this.maxQueuedParseEntries = this.queuedParseEntries
            }
        }

        this.refreshParseMode()
        void this.dispatchNextParseBatch()
    }

    private shouldAsyncParse(rawContent: string): boolean {
        const trimmed = rawContent.trimStart()
        return trimmed.startsWith('{')
    }

    private buildWorkerEnv(): StorageWorkerEnv {
        return {
            STORAGE_TYPE: config.storageType,
            SQLITE_PATH: config.sqlite.path,
            SQLITE_JOURNAL_MODE: config.sqlite.journalMode,
            SQLITE_SYNCHRONOUS: config.sqlite.synchronous,
            MYSQL_HOST: config.mysql.host,
            MYSQL_PORT: String(config.mysql.port),
            MYSQL_USER: config.mysql.user,
            MYSQL_PASSWORD: config.mysql.password,
            MYSQL_DATABASE: config.mysql.database,
            CLICKHOUSE_HOST: config.clickhouse.host,
            CLICKHOUSE_DATABASE: config.clickhouse.database,
            CLICKHOUSE_USER: config.clickhouse.user,
            CLICKHOUSE_PASSWORD: config.clickhouse.password,
            TIMEZONE: config.timezone,
            TZ: config.timezone,
        }
    }

    private refreshParseMode() {
        const shouldDegrade =
            this.queuedWriteEntries >= LogCollector.PARSE_DEGRADE_WRITE_THRESHOLD
            || this.logBuffer.length >= LogCollector.PARSE_DEGRADE_BUFFER_THRESHOLD
            || this.queuedParseEntries >= LogCollector.MAX_PARSE_QUEUE_ENTRIES
            || this.queuedBackfillEntries >= LogCollector.MAX_BACKFILL_QUEUE_ENTRIES

        if (shouldDegrade) {
            this.parseMode = 'degraded'
        } else if (
            this.parseMode === 'degraded'
            && this.queuedWriteEntries <= LogCollector.PARSE_RECOVER_WRITE_THRESHOLD
            && this.logBuffer.length <= LogCollector.PARSE_RECOVER_BUFFER_THRESHOLD
            && this.queuedParseEntries < Math.floor(LogCollector.MAX_PARSE_QUEUE_ENTRIES / 2)
            && this.queuedBackfillEntries < Math.floor(LogCollector.MAX_BACKFILL_QUEUE_ENTRIES / 2)
        ) {
            this.parseMode = 'active'
        }

        this.stats.parseMode = this.parseMode
    }

    private async dispatchNextParseBatch() {
        if (!this.parser || this.inFlightParseBatch || this.pendingParseBatches.length === 0) {
            return
        }

        if (this.parserReady) {
            await this.parserReady
        }

        const batch = this.pendingParseBatches.shift()
        if (!batch || !this.parser) {
            return
        }

        this.inFlightParseBatch = batch
        this.parser.postMessage({
            type: 'parse',
            batchId: batch.batchId,
            entries: batch.entries,
        } satisfies ParserInboundMessage)
    }

    private async handleParserMessage(message: ParserOutboundMessage) {
        if (message.type === 'ready') {
            this.resolveParserReady?.()
            this.resolveParserReady = null
            this.rejectParserReady = null
            return
        }

        if (message.type === 'closed') {
            this.resolveParserClosed?.()
            this.resolveParserClosed = null
            return
        }

        if (message.type === 'fatal') {
            console.error('[LogCollector] Parser worker fatal:', message.error)
            this.rejectParserReady?.(new Error(message.error))
            return
        }

        const batch = this.inFlightParseBatch
        if (!batch || batch.batchId !== message.batchId) {
            return
        }

        this.inFlightParseBatch = null

        if (message.type === 'parse-error') {
            this.queuedParseEntries = Math.max(0, this.queuedParseEntries - batch.entries.length)
            this.stats.totalParseErrors++
            this.stats.droppedParseEntries += batch.entries.length
            console.error('[LogCollector] Failed to parse batch:', message.error)
            this.refreshParseMode()
            await this.dispatchNextParseBatch()
            return
        }

        this.queuedParseEntries = Math.max(0, this.queuedParseEntries - batch.entries.length)
        this.stats.totalParseBatches++
        this.stats.totalEntriesParsed += message.patches.length
        this.queueBackfillPatches(message.patches)
        this.refreshParseMode()
        await this.dispatchNextParseBatch()
    }

    private async drainParserQueue() {
        while (this.pendingParseBatches.length > 0 || this.inFlightParseBatch) {
            await Bun.sleep(50)
        }
    }

    private queueBackfillPatches(patches: import('./storage').ParsedLogPatch[]) {
        if (patches.length === 0) {
            return
        }

        if (this.queuedBackfillEntries + patches.length > LogCollector.MAX_BACKFILL_QUEUE_ENTRIES) {
            this.parseMode = 'degraded'
            this.stats.parseMode = this.parseMode
            this.stats.droppedParseEntries += patches.length
            return
        }

        this.pendingBackfillBatches.push({
            batchId: this.nextBackfillBatchId++,
            patches,
        })
        this.queuedBackfillEntries += patches.length
        if (this.queuedBackfillEntries > this.maxQueuedBackfillEntries) {
            this.maxQueuedBackfillEntries = this.queuedBackfillEntries
        }

        this.refreshParseMode()
        void this.dispatchNextWriterJob()
    }

    private scheduleResume(event: DockerEvent) {
        const key = event.containerName || event.containerId
        this.pendingResumeEvents.set(key, event)

        const existingTimer = this.pendingResumeTimers.get(key)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const timer = setTimeout(() => {
            this.pendingResumeTimers.delete(key)
            const pendingEvent = this.pendingResumeEvents.get(key)
            if (!pendingEvent) {
                return
            }

            this.pendingResumeEvents.delete(key)
            void this.performResume(pendingEvent)
        }, LogCollector.RESUME_DEBOUNCE_MS)

        this.pendingResumeTimers.set(key, timer)
    }

    private async performResume(event: DockerEvent) {
        let resolved = await this.resolveResumeTarget(event)
        if (!resolved) {
            console.warn(`Failed to resolve service for ${event.containerName}: container not found after debounce`)
            return
        }

        const {containerId, containerName, labels} = resolved
        const serviceUuid = await this.resolver.resolve(labels, containerName)
        if (!(await this.storage.isContainerWatched(serviceUuid))) {
            return
        }

        this.removeStaleWatchedEntries(serviceUuid, containerId)

        try {
            await this.watchContainer(containerId, containerName, serviceUuid, {
                forceNewInstance: true,
                since: this.getReplaySince(event.eventTime),
            })
            console.log(`Auto-resumed watching container: ${containerName}`)
        } catch (err) {
            console.warn(`Failed to auto-resume watching ${containerName}:`, toErrorMessage(err))
        }
    }

    private async resolveResumeTarget(event: DockerEvent): Promise<{ containerId: string; containerName: string; labels: Record<string, string> } | null> {
        try {
            const info = await import('./docker').then(({getContainer}) => getContainer(event.containerId))
            return {
                containerId: info.Id,
                containerName: info.Name?.replace(/^\//, '') || event.containerName || event.containerId,
                labels: info.Config?.Labels || {},
            }
        } catch {
        }

        if (!event.containerName) {
            return null
        }

        const containers = await listContainers(false)
        const matched = containers.find(container => {
            const name = container.Names?.[0]?.replace(/^\//, '') || ''
            return name === event.containerName
        })
        if (!matched) {
            return null
        }

        return {
            containerId: matched.Id,
            containerName: matched.Names?.[0]?.replace(/^\//, '') || matched.Id,
            labels: matched.Labels || {},
        }
    }

    private removeStaleWatchedEntries(serviceUuid: string, keepContainerId: string) {
        for (const [containerId, watched] of this.watched.entries()) {
            if (watched.serviceUuid !== serviceUuid || containerId === keepContainerId) {
                continue
            }

            watched.stream?.destroy()
            this.watched.delete(containerId)
        }
    }
}
