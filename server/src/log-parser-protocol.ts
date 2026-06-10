import type {ParsedLogPatch} from './storage'

export interface ParseCandidate {
    id: number
    rawContent: string
}

export type ParserInboundMessage =
    | { type: 'parse'; batchId: number; entries: ParseCandidate[] }
    | { type: 'close' }

export type ParserOutboundMessage =
    | { type: 'ready' }
    | { type: 'parsed'; batchId: number; patches: ParsedLogPatch[] }
    | { type: 'parse-error'; batchId: number; error: string }
    | { type: 'closed' }
    | { type: 'fatal'; error: string }
