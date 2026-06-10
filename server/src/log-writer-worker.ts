import {createStorage} from './storage'
import type {WriterInboundMessage, WriterOutboundMessage} from './log-writer-protocol'

const storage = await createStorage((process.env.STORAGE_TYPE || 'sqlite') as 'sqlite' | 'mysql' | 'clickhouse')
await storage.initialize()
postMessage({type: 'ready'} satisfies WriterOutboundMessage)

onmessage = async (event: MessageEvent<WriterInboundMessage>) => {
    const message = event.data

    if (message.type === 'close') {
        await storage.close()
        postMessage({type: 'closed'} satisfies WriterOutboundMessage)
        self.close()
        return
    }

    if (message.type !== 'write') {
        return
    }

    try {
        await storage.insertLogs(message.entries)
        postMessage({
            type: 'written',
            batchId: message.batchId,
            entries: message.entries,
        } satisfies WriterOutboundMessage)
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        postMessage({
            type: 'write-error',
            batchId: message.batchId,
            error: errorMessage,
        } satisfies WriterOutboundMessage)
    }
}
