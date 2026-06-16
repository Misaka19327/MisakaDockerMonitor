import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useNavigate, useParams} from 'react-router-dom'
import {useQuery} from '@tanstack/react-query'
import {api} from '../lib/api'
import {markContainerOpened} from '../lib/container-preferences'
import type {Container, LogEntry} from '../types'
import {useContainerStatusStream} from '../hooks/useContainerStatusStream'
import {useLogPagination} from '../hooks/useLogPagination'
import {usePullToLoad} from '../hooks/usePullToLoad'
import {formatInstanceLabel, type TimeRange} from '../lib/time'
import {getLogFieldValue, type ResolvedLogEntry} from '../lib/log-entry'
import {Button} from './ui/button'
import {Input} from './ui/input'
import {Badge} from './ui/badge'
import {Select} from './ui/select'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger,} from './ui/drawer'
import {LogEntryView} from './LogEntry'
import {GroupPanel} from './GroupPanel'
import {InlineGroup} from './InlineGroup'
import {TimeFilter} from './TimeFilter'
import {useUiPreferences} from '../lib/ui-preferences'
import {
    ArrowDown,
    ArrowLeft,
    ArrowUp as ArrowUpIcon,
    ArrowUpDown,
    Braces,
    ChevronDown,
    ChevronRight,
    Clock,
    Cpu,
    Group,
    HardDrive,
    Hash,
    Heart,
    Loader2,
    MemoryStick,
    Network,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    Search,
    Shield,
} from 'lucide-react'

export function LogViewer() {
    const {id: serviceUuid} = useParams<{ id: string }>()
    const navigate = useNavigate()
    const {t} = useUiPreferences()

    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [instanceId, setInstanceId] = useState('')
    const [timeRange, setTimeRange] = useState<TimeRange>({})
    const [autoScroll, setAutoScroll] = useState(true)
    const [paused, setPaused] = useState(false)
    const [reverseOrder, setReverseOrder] = useState(false)
    const [showGroupPanel, setShowGroupPanel] = useState(false)
    const [showScrollTop, setShowScrollTop] = useState(false)
    const [loadOlderArmed, setLoadOlderArmed] = useState(false)
    const [groupField, setGroupField] = useState('level')
    const [inlineGrouping, setInlineGrouping] = useState(false)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
    const [envDrawerOpen, setEnvDrawerOpen] = useState(false)

    const scrollRef = useRef<HTMLDivElement>(null)

    // SSE: real-time status + log push
    const [sseStatus, setSseStatus] = useState<Partial<Container> | null>(null)

    const {data: appConfig} = useQuery({queryKey: ['app-config'], queryFn: () => api.config.get()})

    const pagination = useLogPagination(serviceUuid, {
        search,
        instanceId,
        timeRange,
        timezone: appConfig?.timezone,
        paused,
    })

    useContainerStatusStream(
        serviceUuid,
        useCallback((data: Record<string, unknown>) => {
            setSseStatus(data as Partial<Container>)
        }, []),
        useCallback((entries: LogEntry[]) => {
            if (entries.length === 0) return
            pagination.pushEntries(entries)
        }, [pagination.pushEntries]),
    )

    const {data: instances} = useQuery({
        queryKey: ['instances', serviceUuid],
        queryFn: () => api.containers.instances(serviceUuid!),
        enabled: !!serviceUuid,
        refetchInterval: 5000,
    })

    const prevInstancesRef = useRef<import('../types').ContainerInstance[]>([])
    useEffect(() => {
        if (!serviceUuid) return
        markContainerOpened(serviceUuid)
    }, [serviceUuid])

    useEffect(() => {
        if (!instances) return
        const prevInstances = prevInstancesRef.current
        prevInstancesRef.current = instances
        if (!instanceId) return
        const current = instances.find(i => i.id === instanceId)
        const prevCurrent = prevInstances.find(i => i.id === instanceId)
        if (current?.status === 'stopped' && prevCurrent?.status === 'running') {
            const running = instances.find(i => i.status === 'running')
            if (running) setInstanceId(running.id)
        }
    }, [instances])

    const container = useMemo(() => {
        const base = pagination.container
        if (!base && !sseStatus) return null
        return {...(base || {}), ...sseStatus} as Container
    }, [pagination.container, sseStatus])

    const entries = pagination.entries

    // Client-side filter for pushed entries
    const filteredEntries = useMemo(() => {
        if (!search) return entries
        return entries.filter(e => {
            if (search && !e.content.includes(search) && !e.rawContent.includes(search)) return false
            return true
        })
    }, [entries, search])
    
    const hasJsonLogs = useMemo(() => filteredEntries.some(e => e.isJson), [filteredEntries])
    
    const displayEntries = useMemo(() => reverseOrder ? [...filteredEntries].reverse() : filteredEntries, [filteredEntries, reverseOrder])

    const groupedEntries = useMemo(() => {
        if (!inlineGrouping || !groupField) return null
        const groups: { key: string; entries: ResolvedLogEntry[] }[] = []
        let currentKey: string | null = null
        let currentEntries: ResolvedLogEntry[] = []
        for (const entry of displayEntries) {
            const fieldValue = getLogFieldValue(entry, groupField)
            if (fieldValue !== currentKey) {
                if (currentEntries.length > 0) groups.push({key: currentKey!, entries: currentEntries})
                currentKey = fieldValue
                currentEntries = [entry]
            } else {
                currentEntries.push(entry)
            }
        }
        if (currentEntries.length > 0) groups.push({key: currentKey!, entries: currentEntries})
        return groups
    }, [displayEntries, inlineGrouping, groupField])

    const groupSummary = useMemo(() => {
        if (!groupField) return []

        const counts = new Map<string, number>()
        for (const entry of filteredEntries) {
            const key = getLogFieldValue(entry, groupField)
            counts.set(key, (counts.get(key) || 0) + 1)
        }

        return Array.from(counts.entries())
            .map(([value, count]) => ({value, count}))
            .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    }, [filteredEntries, groupField])

    const toggleGroup = useCallback((key: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next
        })
    }, [])

    // --- Scroll-position bookkeeping ---------------------------------------
    // "Tail" = the end where newest entries arrive: bottom in normal order,
    // top in reverse order. We track whether the user is pinned near the tail
    // so that only genuine tail growth (newer logs) auto-follows; loading
    // older entries prepends to the head and must NOT yank the viewport.
    const isPinnedToTail = useRef(true)
    // Snapshot of entry count before a render, to detect head vs tail growth.
    const prevEntryCountRef = useRef(0)
    // Snapshot of scrollHeight before fetching older entries, for anchor restore.
    const preFetchScrollHeightRef = useRef<number | null>(null)

    // Reset pin-tracking when filters/order change so we re-pin to the tail.
    useEffect(() => {
        isPinnedToTail.current = true
        prevEntryCountRef.current = filteredEntries.length
        // Jump to the tail on filter change so the newest window is in view.
        requestAnimationFrame(() => {
            const el = scrollRef.current
            if (!el) return
            el.scrollTop = reverseOrder ? 0 : el.scrollHeight
        })
    }, [search, instanceId, timeRange, reverseOrder])

    // Follow the tail only when auto-follow is on, user is pinned, and the list
    // grew at the tail (newer logs). Loading older entries also grows the list,
    // but the user is then at the head (not pinned), so this stays inert.
    useEffect(() => {
        const grew = filteredEntries.length - prevEntryCountRef.current
        prevEntryCountRef.current = filteredEntries.length
        if (grew <= 0 || !autoScroll || !isPinnedToTail.current) return
        // Tail grew (newer logs arrived): keep the viewport pinned.
        const el = scrollRef.current
        if (!el) return
        if (reverseOrder) {
            // Newest at top: stay at top.
            el.scrollTop = 0
        } else {
            // Newest at bottom: stay at bottom.
            el.scrollTop = el.scrollHeight
        }
    }, [filteredEntries.length, reverseOrder, autoScroll])

    const handleScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        setShowScrollTop(el.scrollTop > 300)
        const distanceFromTail = reverseOrder
            ? el.scrollTop
            : el.scrollHeight - el.scrollTop - el.clientHeight
        isPinnedToTail.current = distanceFromTail < 50
    }, [reverseOrder])

    // Fetch older entries while preserving the user's scroll position:
    // capture scrollHeight before, restore the delta after prepend.
    const fetchOlder = useCallback(() => {
        if (!pagination.hasOlder || pagination.loadingOlder) return
        const el = scrollRef.current
        if (el) preFetchScrollHeightRef.current = el.scrollHeight
        pagination.fetchOlder()
    }, [pagination.fetchOlder, pagination.hasOlder, pagination.loadingOlder])

    // After older entries land, compensate scrollTop so the viewport stays put.
    // Bound to pageCount (history pages) — NOT entry length — so live SSE pushes
    // don't trigger spurious scroll compensation.
    useEffect(() => {
        if (preFetchScrollHeightRef.current == null) return
        const el = scrollRef.current
        if (!el) return
        const prev = preFetchScrollHeightRef.current
        preFetchScrollHeightRef.current = null
        requestAnimationFrame(() => {
            if (reverseOrder) {
                // Older entries appended at the bottom (reverse view): keep top position.
                // No compensation needed since growth is below the viewport.
            } else {
                // Older entries prepended at the top: shift down by the added height.
                el.scrollTop += el.scrollHeight - prev
            }
        })
    }, [pagination.pageCount, reverseOrder])

    // --- Load-older sentinels ----------------------------------------------
    // Normal order: reaching the top loads older. Reverse order: reaching the
    // bottom loads older. The button remains as a visible manual fallback.
    const topPull = usePullToLoad({
        rootRef: scrollRef,
        enabled: !reverseOrder && pagination.hasOlder,
        armed: loadOlderArmed,
        loading: pagination.loadingOlder,
        onTrigger: fetchOlder,
    })
    const bottomPull = usePullToLoad({
        rootRef: scrollRef,
        enabled: reverseOrder && pagination.hasOlder,
        armed: loadOlderArmed,
        loading: pagination.loadingOlder,
        onTrigger: fetchOlder,
    })

    const scrollToTop = useCallback(() => {
        scrollRef.current?.scrollTo({top: 0, behavior: 'smooth'})
    }, [])
    const armLoadOlder = useCallback(() => {
        setLoadOlderArmed(true)
    }, [])
    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setSearch(searchInput)
    }

    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
            <div className="border-b px-4 py-3">
                <div className="flex items-center gap-3 mb-3">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/')}><ArrowLeft
                        className="h-4 w-4"/></Button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-lg font-semibold truncate">{container?.name || serviceUuid}</h1>
                        <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                            <span className="truncate">{container?.image}</span>
                            {container?.stats && (<>
                                {container.stats.cpuPercent != null && (
                                    <span className="inline-flex items-center gap-0.5 shrink-0"><Cpu
                                        className="h-3 w-3"/><span
                                        className={container.stats.cpuPercent > 80 ? 'text-red-500' : container.stats.cpuPercent > 50 ? 'text-amber-500' : 'text-emerald-500'}>{container.stats.cpuPercent}%</span></span>)}
                                {container.stats.memUsage && (
                                    <span className="inline-flex items-center gap-0.5 shrink-0"><MemoryStick
                                        className="h-3 w-3"/><span
                                        className={(container.stats.memPercent ?? 0) > 80 ? 'text-red-500' : (container.stats.memPercent ?? 0) > 50 ? 'text-amber-500' : 'text-emerald-500'}>{container.stats.memPercent != null ? `${container.stats.memUsage} (${container.stats.memPercent}%)` : container.stats.memUsage}</span></span>)}
                                {(container.stats.diskRead || container.stats.diskWrite) && (
                                    <span className="inline-flex items-center gap-0.5 shrink-0"><HardDrive
                                        className="h-3 w-3"/>{[container.stats.diskRead && `R ${container.stats.diskRead}`, container.stats.diskWrite && `W ${container.stats.diskWrite}`].filter(Boolean).join(' / ')}</span>)}
                            </>)}
                            {container?.health && (<span className="inline-flex items-center gap-0.5 shrink-0"><Heart
                                className={`h-3 w-3 ${container.health === 'healthy' ? 'text-emerald-500' : container.health === 'unhealthy' ? 'text-red-500' : 'text-amber-500'}`}/><span
                                className={container.health === 'healthy' ? 'text-emerald-500' : container.health === 'unhealthy' ? 'text-red-500' : 'text-amber-500'}>{container.health}</span></span>)}
                            {container?.pid != null && container.pid > 0 && (
                                <span className="inline-flex items-center gap-0.5 shrink-0"><Hash
                                    className="h-3 w-3"/>{t('viewer.pidPrefix')}: {container.pid}</span>)}
                            {container?.uptime && (<span className="inline-flex items-center gap-0.5 shrink-0"><Clock
                                className="h-3 w-3"/>{t('viewer.upPrefix')}: {container.uptime}</span>)}
                            {container?.state !== 'running' && container?.exitCode != null && (<span
                                className="inline-flex items-center gap-0.5 shrink-0">{t('viewer.exitPrefix')}: {container.exitCode}</span>)}
                            {(container?.restartCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-0.5 shrink-0"><RotateCcw
                                    className="h-3 w-3"/>{container?.restartCount}</span>)}
                            {container?.networks && container.networks.length > 0 && (
                                <span className="inline-flex items-center gap-0.5 shrink-0"><Network
                                    className="h-3 w-3"/>{container.networks.join(', ')}</span>)}
                            {container?.restartPolicy && (
                                <span className="inline-flex items-center gap-0.5 shrink-0"><Shield
                                    className="h-3 w-3"/>{container.restartPolicy}</span>)}
                        </div>
                    </div>
                    <Drawer direction="right" open={envDrawerOpen} onOpenChange={setEnvDrawerOpen}>
                        <DrawerTrigger asChild><Button variant="ghost" size="sm" title={t('viewer.env')}><Braces
                            className="h-4 w-4"/>{t('viewer.env')}</Button></DrawerTrigger>
                        <DrawerContent>
                            <DrawerHeader><DrawerTitle>{t('viewer.env')}</DrawerTitle><DrawerDescription>{container?.name || serviceUuid}</DrawerDescription></DrawerHeader>
                            <div className="flex-1 overflow-auto px-4 pb-4">
                                {container?.env && container.env.length > 0 ? (
                                    <div className="space-y-1">{container.env.map((line, i) => {
                                        const eqIndex = line.indexOf('=');
                                        const key = eqIndex >= 0 ? line.slice(0, eqIndex) : line;
                                        const value = eqIndex >= 0 ? line.slice(eqIndex + 1) : '';
                                        return (<div key={i}
                                                     className="group rounded-md border px-3 py-2 text-sm hover:bg-accent/50 transition-colors">
                                            <div
                                                className="font-mono text-xs font-medium text-foreground break-all">{key}</div>
                                            {value && (<div
                                                className="font-mono text-xs text-muted-foreground mt-0.5 break-all select-all">{value}</div>)}
                                        </div>)
                                    })}</div>) : (<div
                                    className="flex items-center justify-center py-12 text-muted-foreground text-sm">{t('viewer.noEnv')}</div>)}
                            </div>
                        </DrawerContent>
                    </Drawer>
                    <Badge
                        variant={container?.state === 'running' ? 'success' : 'soft-destructive'}>{container?.state || t('viewer.containerUnknown')}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => setPaused(!paused)}>{paused ?
                        <Play className="h-4 w-4"/> :
                        <Pause className="h-4 w-4"/>}{paused ? t('action.resume') : t('action.pause')}</Button>
                </div>
                <div className="flex items-center gap-2 w-full">
                    <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-[200px]">
                        <div className="relative flex-1"><Search
                            className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/><Input
                            value={searchInput} onChange={e => setSearchInput(e.target.value)}
                            placeholder={t('viewer.searchLogs')} className="pl-9 h-9 w-full"/></div>
                        <Button type="submit" size="sm" variant="outline">{t('action.search')}</Button>
                        {search && (<Button size="sm" variant="ghost" onClick={() => {
                            setSearch('');
                            setSearchInput('')
                        }}>{t('action.clear')}</Button>)}
                    </form>
                    <TimeFilter value={timeRange} onChange={setTimeRange} timezone={appConfig?.timezone}/>
                    <Select value={instanceId} onChange={e => setInstanceId(e.target.value)}
                            options={(instances || []).map(inst => ({
                                value: inst.id,
                                label: formatInstanceLabel(inst.startedAt, inst.status, appConfig?.timezone)
                            }))} placeholder={t('viewer.allInstances')} className="w-64"/>
                    <Button variant={reverseOrder ? 'default' : 'ghost'} size="icon"
                            onClick={() => setReverseOrder(!reverseOrder)}
                            title={reverseOrder ? t('viewer.sort.forward') : t('viewer.sort.reverse')}><ArrowUpDown
                        className="h-4 w-4"/></Button>
                    <Button variant="ghost" size="icon" onClick={() => setAutoScroll(!autoScroll)}
                            title={autoScroll ? t('viewer.autoScroll.disable') : t('viewer.autoScroll.enable')}>
                        {reverseOrder ? (<ArrowUpIcon
                            className={`h-4 w-4 ${autoScroll ? 'text-primary' : 'text-muted-foreground'}`}/>) : (
                            <ArrowDown
                                className={`h-4 w-4 ${autoScroll ? 'text-primary' : 'text-muted-foreground'}`}/>)}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={pagination.invalidate}
                            title={t('viewer.refreshLogs')}><RefreshCw className="h-4 w-4"/></Button>
                </div>
                {hasJsonLogs && (<div className="mt-2">
                    <button
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowGroupPanel(!showGroupPanel)}>
                        {showGroupPanel ? <ChevronDown className="h-3.5 w-3.5"/> :
                            <ChevronRight className="h-3.5 w-3.5"/>}<Group
                        className="h-3.5 w-3.5"/>{showGroupPanel ? t('viewer.groupPanel.hide') : t('viewer.groupPanel.show')}
                    </button>
                    {showGroupPanel && (
                        <div className="mt-2"><GroupPanel field={groupField} groups={groupSummary}
                                                          onFieldChange={setGroupField}
                                                          inlineGrouping={inlineGrouping}
                                                          onInlineToggle={() => setInlineGrouping(!inlineGrouping)}/>
                        </div>)}
                </div>)}
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>{t('viewer.totalEntries', {count: pagination.total})}</span>
                    {search && <span>{t('viewer.filteredBy', {value: search})}</span>}
                    {(timeRange.startTime || timeRange.endTime) && (
                        <span>
                            {[
                                timeRange.startTime && timeRange.startTime.replace('T', ' '),
                                timeRange.endTime && timeRange.endTime.replace('T', ' '),
                            ].filter(Boolean).join(' ~ ')}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-hidden relative">
                <div
                    ref={scrollRef}
                    className="h-full overflow-auto px-2 py-2"
                    onPointerDown={armLoadOlder}
                    onTouchStart={armLoadOlder}
                    onWheel={armLoadOlder}
                    onScroll={handleScroll}
                >
                    {/* Top pull indicator (normal order: pull here to load older) */}
                    {!reverseOrder && pagination.hasOlder && (
                        <PullIndicator
                            api={topPull}
                            hint={t('viewer.pullToLoad.hint')}
                            loadingLabel={t('viewer.pullToLoad.loading')}
                        />
                    )}
                    {/* End-of-history notice when no older pages remain (normal order, at top) */}
                    {!reverseOrder && !pagination.hasOlder && filteredEntries.length > 0 && (
                        <div
                            className="py-2 text-center text-[11px] text-muted-foreground/70">{t('viewer.pullToLoad.noMore')}</div>
                    )}
                    {pagination.isInitialLoading && filteredEntries.length === 0 && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw
                            className="h-5 w-5 animate-spin mr-2"/>{t('viewer.loading')}</div>)}
                    {!pagination.isInitialLoading && filteredEntries.length === 0 && (
                        <div
                            className="flex items-center justify-center py-20 text-muted-foreground">{t('viewer.noLogs')}</div>)}
                    {inlineGrouping && groupedEntries ? (<div>{groupedEntries.map((group, gi) => (
                        <InlineGroup key={`${group.key}-${gi}`} groupKey={group.key} colorIndex={gi}
                                     count={group.entries.length} collapsed={collapsedGroups.has(`${gi}`)}
                                     onToggle={() => toggleGroup(`${gi}`)}>
                            <div className="space-y-0.5">{group.entries.map((entry, i) => (
                                <LogEntryView key={entry.id || `${gi}-${i}`} entry={entry}
                                              timezone={appConfig?.timezone}/>))}</div>
                        </InlineGroup>))}</div>) : (<div className="space-y-0.5">{displayEntries.map((entry, i) => (
                        <LogEntryView key={entry.id || i} entry={entry} timezone={appConfig?.timezone}/>))}</div>)}
                    {/* Bottom pull indicator (reverse order: older entries live here) */}
                    {reverseOrder && pagination.hasOlder && (
                        <PullIndicator
                            api={bottomPull}
                            hint={t('viewer.pullToLoad.hint')}
                            loadingLabel={t('viewer.pullToLoad.loading')}
                        />
                    )}
                    {reverseOrder && !pagination.hasOlder && filteredEntries.length > 0 && (
                        <div
                            className="py-2 text-center text-[11px] text-muted-foreground/70">{t('viewer.pullToLoad.noMore')}</div>
                    )}
                </div>
                {showScrollTop && (<button onClick={scrollToTop}
                                           className="fixed bottom-6 right-6 z-50 h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 flex items-center justify-center transition-opacity"
                                           title={t('viewer.scrollTop')}><ArrowUpIcon className="h-5 w-5"/></button>)}
            </div>
        </div>
    )
}

function PullIndicator({api, hint, loadingLabel}: {
    api: {
        sentinelRef: React.RefObject<HTMLDivElement | null>
        loading: boolean
        active: boolean
        trigger: () => void
    }
    hint: string
    loadingLabel: string
}) {
    const {sentinelRef, loading, active, trigger} = api
    return (
        <div ref={sentinelRef} className="flex min-h-8 items-center justify-center py-1">
            <button
                type="button"
                onClick={trigger}
                disabled={!active}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
            >
                {loading ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin"/>{loadingLabel}</>
                ) : (
                    <><ChevronDown className="h-3.5 w-3.5"/>{hint}</>
                )}
            </button>
        </div>
    )
}
