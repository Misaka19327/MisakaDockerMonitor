import {useEffect, useRef} from 'react'
import type {LogEntry} from '../types'

export function useContainerStatusStream(
    serviceUuid: string | undefined,
    onStatus?: (data: Record<string, unknown>) => void,
    onLogEntries?: (entries: LogEntry[]) => void,
) {
    const onStatusRef = useRef(onStatus)
    onStatusRef.current = onStatus
    const onLogEntriesRef = useRef(onLogEntries)
    onLogEntriesRef.current = onLogEntries

    useEffect(() => {
        if (!serviceUuid) return

        const token = localStorage.getItem('token')
        const url = `/api/logs/${serviceUuid}/live${token ? `?token=${encodeURIComponent(token)}` : ''}`
        const es = new EventSource(url)

        es.addEventListener('status', (e: MessageEvent) => {
            try {
                const statusData = JSON.parse(e.data)
                onStatusRef.current?.(statusData)
            } catch {
            }
        })
        
        es.onmessage = (e: MessageEvent) => {
            try {
                const payload = JSON.parse(e.data)
                const entries = Array.isArray(payload) ? payload : [payload]
                onLogEntriesRef.current?.(entries)
            } catch {
            }
        }

        return () => {
            es.close()
        }
    }, [serviceUuid])
}
