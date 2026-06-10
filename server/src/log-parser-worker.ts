import {parseLogLine} from './log-parser'
import type {ParserInboundMessage, ParserOutboundMessage} from './log-parser-protocol'
import {parsedLogToPatch} from './storage'

postMessage({type: 'ready'} satisfies ParserOutboundMessage)

onmessage = async (event: MessageEvent<ParserInboundMessage>) => {
    const message = event.data

    if (message.type === 'close') {
        postMessage({type: 'closed'} satisfies ParserOutboundMessage)
        self.close()
        return
    }

    if (message.type !== 'parse') {
        return
    }

    try {
        const patches = message.entries.map(entry => parsedLogToPatch(entry.id, parseLogLine(entry.rawContent)))
        postMessage({
            type: 'parsed',
            batchId: message.batchId,
            patches,
        } satisfies ParserOutboundMessage)
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        postMessage({
            type: 'parse-error',
            batchId: message.batchId,
            error: errorMessage,
        } satisfies ParserOutboundMessage)
    }
}
