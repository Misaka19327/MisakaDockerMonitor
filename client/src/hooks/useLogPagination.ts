import {useEffect, useMemo, useRef, useState, useCallback} from 'react'
import {useInfiniteQuery, useQueryClient} from '@tanstack/react-query'
import {api} from '../lib/api'
import {resolveLogEntry} from '../lib/log-entry'
import type {Container, LogEntry, LogQueryResult} from '../types'
import {timeRangeToQuery, timestampToComparableStorageValue, type TimeRange} from '../lib/time'

const PAGE_SIZE = 100
const MAX_PUSHED_ENTRIES = 2000

export interface LogPaginationResult {
    /** Merged historical pages + live SSE entries, ascending by id (oldest first). */
    entries: ReturnType<typeof resolveLogEntry>[]
    /** Whether there are more older entries that can be loaded. */
    hasOlder: boolean
    /** Whether an older page is currently being fetched. */
    loadingOlder: boolean
    /** Total matching rows from the latest page (server-side count). */
    total: number
    /** Number of accumulated history pages. */
    pageCount: number
    /** Whether the very first page is still loading. */
    isInitialLoading: boolean
    /** Latest fetched container detail (from any page). */
    container: Container | null
    /** Register an SSE-pushed entry batch (live tail). */
    pushEntries: (entries: LogEntry[]) => void
    /** Drop all pushed entries (used on manual refresh / filter reset). */
    clearPushed: () => void
    /** Load the next older page. No-op when hasOlder is false or already loading. */
    fetchOlder: () => void
    /** Invalidate all pages (manual refresh). */
    invalidate: () => void
}

function matchesActiveFilters(entry: LogEntry, filters: {
    search: string
    instanceId: string
    queryRange: TimeRange
    timezone?: string
}): boolean {
    const {search, instanceId, queryRange, timezone} = filters

    if (instanceId && entry.instanceId !== instanceId) return false
    if (search && !entry.content.includes(search) && !entry.rawContent.includes(search)) return false

    const hasRange = !!(queryRange.startTime || queryRange.endTime)
    if (!hasRange) return true

    const ts = timestampToComparableStorageValue(entry.timestamp ?? entry.createdAt, timezone)
    if (!ts) return false
    if (queryRange.startTime && ts < queryRange.startTime) return false
    if (queryRange.endTime && ts > queryRange.endTime) return false
    return true
}

export function useLogPagination(
    serviceUuid: string | undefined,
    params: { search: string; instanceId: string; timeRange: TimeRange; timezone?: string; paused: boolean },
): LogPaginationResult {
    const {search, instanceId, timeRange, timezone, paused} = params
    const queryClient = useQueryClient()

    // Pushed entries from SSE, keyed by id, insertion-order FIFO capped.
    const [pushedEntries, setPushedEntries] = useState<Map<number, LogEntry>>(new Map())
    const queryRange = useMemo(() => timeRangeToQuery(timeRange), [timeRange])

    const queryKey = useMemo(
        () => ['logs', serviceUuid, search, instanceId, queryRange] as const,
        [serviceUuid, search, instanceId, queryRange],
    )

    useEffect(() => {
        setPushedEntries(new Map())
    }, [serviceUuid, search, instanceId, queryRange])

    const query = useInfiniteQuery<LogQueryResult>({
        queryKey,
        queryFn: ({pageParam}) =>
            api.logs.query(serviceUuid!, {
                search: search || undefined,
                instanceId: instanceId || undefined,
                startTime: queryRange.startTime || undefined,
                endTime: queryRange.endTime || undefined,
                limit: PAGE_SIZE,
                offset: pageParam as number,
            }),
        initialPageParam: 0,
        getNextPageParam: (lastPage, _allPages, lastPageParam) => {
            if (!lastPage.hasMore) return undefined
            return (lastPageParam as number) + PAGE_SIZE
        },
        enabled: !!serviceUuid,
        // Refresh on a slow cadence for container meta + newest window.
        refetchInterval: paused ? false : 10000,
    })

    const pages = query.data?.pages ?? []

    // Flatten all pages' entries (each page is oldest-first within its window),
    // dedup by id, then merge live pushed entries, finally sort ascending.
    const entries = useMemo(() => {
        const merged = new Map<number, LogEntry>()
        for (const page of pages) {
            for (const e of page.entries) {
                if (e.id != null) merged.set(e.id, e)
            }
        }
        for (const [id, e] of pushedEntries) {
            if (!merged.has(id)) merged.set(id, e)
        }
        return Array.from(merged.values())
            .sort((a, b) => (a.id || 0) - (b.id || 0))
            .map(resolveLogEntry)
    }, [pages, pushedEntries])

    const lastPage = pages.length > 0 ? pages[pages.length - 1] : null

    const pushEntries = useCallback((incoming: LogEntry[]) => {
        if (incoming.length === 0) return
        setPushedEntries(prev => {
            const next = new Map(prev)
            for (const entry of incoming) {
                if (entry.id == null || next.has(entry.id)) continue
                if (!matchesActiveFilters(entry, {search, instanceId, queryRange, timezone})) continue
                next.set(entry.id, entry)
            }
            while (next.size > MAX_PUSHED_ENTRIES) {
                const oldestKey = next.keys().next().value
                if (oldestKey == null) break
                next.delete(oldestKey)
            }
            return next
        })
    }, [search, instanceId, queryRange, timezone])

    const clearPushed = useCallback(() => setPushedEntries(new Map()), [])

    const fetchOlder = useCallback(() => {
        if (query.hasNextPage && !query.isFetchingNextPage) {
            query.fetchNextPage()
        }
    }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage])

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({queryKey})
        setPushedEntries(new Map())
    }, [queryClient, queryKey])

    // Track first-page loading for the initial spinner.
    const isInitialLoading = query.isLoading && !query.isFetchingNextPage

    return {
        entries,
        hasOlder: !!query.hasNextPage,
        loadingOlder: query.isFetchingNextPage,
        total: lastPage?.total ?? 0,
        pageCount: pages.length,
        isInitialLoading,
        container: lastPage?.container ?? null,
        pushEntries,
        clearPushed,
        fetchOlder,
        invalidate,
    }
}
