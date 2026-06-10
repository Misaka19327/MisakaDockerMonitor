import {useEffect, useRef} from 'react'
import type {LogEntry} from '../types'

export function useContainerStatusStream(
    serviceUuid: string | undefined,
    onStatus?: (data: Record<string, unknown>) => void,
    onLogEntry?: (entry: LogEntry) => void,
) {
    const onStatusRef = useRef(onStatus)
    onStatusRef.current = onStatus
    const onLogEntryRef = useRef(onLogEntry)
    onLogEntryRef.current = onLogEntry

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
                const entry = JSON.parse(e.data)
                onLogEntryRef.current?.(entry)
            } catch {
            }
        }

        return () => {
            es.close()
        }
    }, [serviceUuid])
}
