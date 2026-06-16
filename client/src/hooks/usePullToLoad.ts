import {useCallback, useEffect, useRef} from 'react'

export interface PullToLoadApi {
    sentinelRef: React.RefObject<HTMLDivElement | null>
    loading: boolean
    active: boolean
    trigger: () => void
}

export interface UsePullToLoadArgs {
    rootRef: React.RefObject<HTMLDivElement | null>
    enabled: boolean
    armed?: boolean
    loading: boolean
    onTrigger: () => void
    rootMargin?: string
}

export function usePullToLoad({
    rootRef,
    enabled,
    armed = true,
    loading,
    onTrigger,
    rootMargin = '96px 0px',
}: UsePullToLoadArgs): PullToLoadApi {
    const sentinelRef = useRef<HTMLDivElement>(null)
    const onTriggerRef = useRef(onTrigger)

    useEffect(() => {
        onTriggerRef.current = onTrigger
    }, [onTrigger])

    const trigger = useCallback(() => {
        if (!enabled || loading) return
        onTriggerRef.current()
    }, [enabled, loading])

    useEffect(() => {
        const root = rootRef.current
        const sentinel = sentinelRef.current
        if (!root || !sentinel || !enabled || !armed || loading) return

        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    onTriggerRef.current()
                }
            },
            {root, rootMargin, threshold: 0.01},
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [armed, enabled, loading, rootMargin, rootRef])

    return {sentinelRef, loading, active: enabled && !loading, trigger}
}
