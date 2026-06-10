import type {LogEntry} from './storage'

export type WriterInboundMessage =
    | { type: 'write'; batchId: number; entries: LogEntry[] }
    | { type: 'close' }

export type WriterOutboundMessage =
    | { type: 'ready' }
    | { type: 'written'; batchId: number; entries: LogEntry[] }
    | { type: 'write-error'; batchId: number; error: string }
    | { type: 'closed' }
    | { type: 'fatal'; error: string }
