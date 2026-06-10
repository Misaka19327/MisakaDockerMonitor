import type {WriterInboundMessage, WriterOutboundMessage} from './log-writer-protocol'
import type {StorageAdapter} from './storage'
import {applyStorageWorkerEnv} from './storage-worker-env'

let storage: StorageAdapter | null = null

onmessage = async (event: MessageEvent<WriterInboundMessage>) => {
    const message = event.data

    if (message.type === 'init') {
        applyStorageWorkerEnv(message.env)
        const {createStorage} = await import('./storage')
        storage = await createStorage((process.env.STORAGE_TYPE || 'sqlite') as 'sqlite' | 'mysql' | 'clickhouse')
        await storage.initialize()
        postMessage({type: 'ready'} satisfies WriterOutboundMessage)
        return
    }

    if (message.type === 'close') {
        await storage?.close()
        postMessage({type: 'closed'} satisfies WriterOutboundMessage)
        self.close()
        return
    }

    if (message.type !== 'write' && message.type !== 'backfill') {
        return
    }

    try {
        if (!storage) throw new Error('Writer worker is not initialized')
        if (message.type === 'write') {
            await storage.insertLogs(message.entries)
            postMessage({
                type: 'written',
                batchId: message.batchId,
                entries: message.entries,
            } satisfies WriterOutboundMessage)
            return
        }

        await storage.backfillParsedLogs(message.patches)
        postMessage({
            type: 'backfilled',
            batchId: message.batchId,
            patchCount: message.patches.length,
        } satisfies WriterOutboundMessage)
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const responseType = message.type === 'write' ? 'write-error' : 'backfill-error'
        postMessage({
            type: responseType,
            batchId: message.batchId,
            error: errorMessage,
        } satisfies WriterOutboundMessage)
    }
}
