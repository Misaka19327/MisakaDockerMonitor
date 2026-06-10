import {useEffect, useRef} from 'react'
import {useQueryClient} from '@tanstack/react-query'

export function useContainerStatusStream(
    containerId: string | undefined,
    onStatus?: (data: Record<string, unknown>) => void
) {
    const queryClient = useQueryClient()
    const onStatusRef = useRef(onStatus)
    onStatusRef.current = onStatus

    useEffect(() => {
        if (!containerId) return

        const token = localStorage.getItem('token')
        const url = `/api/logs/${containerId}/live${token ? `?token=${encodeURIComponent(token)}` : ''}`
        const es = new EventSource(url)
        
        es.addEventListener('status', (e: MessageEvent) => {
            try {
                const statusData = JSON.parse(e.data)
                onStatusRef.current?.(statusData)
            } catch { /* ignore parse errors */
            }
        })
        
        return () => {
            es.close()
        }
    }, [containerId, queryClient])
}
