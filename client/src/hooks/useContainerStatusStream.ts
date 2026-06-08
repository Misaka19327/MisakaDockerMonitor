import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export function useContainerStatusStream(containerId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!containerId) return

    const token = localStorage.getItem('token')
    const url = `/api/logs/${containerId}/live${token ? `?token=${encodeURIComponent(token)}` : ''}`
    const es = new EventSource(url)

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const statusData = JSON.parse(e.data)
        queryClient.setQueryData(['container', containerId], (old: any) => {
          if (!old) return old
          return { ...old, ...statusData }
        })
      } catch { /* ignore parse errors */ }
    })

    return () => { es.close() }
  }, [containerId, queryClient])
}
