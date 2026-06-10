import type {LogEntry, ParsedLogPatch} from './storage'
import type {StorageWorkerEnv} from './storage-worker-env'

export type WriterInboundMessage =
    | { type: 'init'; env: StorageWorkerEnv }
    | { type: 'write'; batchId: number; entries: LogEntry[] }
    | { type: 'backfill'; batchId: number; patches: ParsedLogPatch[] }
    | { type: 'close' }

export type WriterOutboundMessage =
    | { type: 'ready' }
    | { type: 'written'; batchId: number; entries: LogEntry[] }
    | { type: 'backfilled'; batchId: number; patchCount: number }
    | { type: 'write-error'; batchId: number; error: string }
    | { type: 'backfill-error'; batchId: number; error: string }
    | { type: 'closed' }
    | { type: 'fatal'; error: string }
