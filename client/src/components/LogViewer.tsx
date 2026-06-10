import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useNavigate, useParams} from 'react-router-dom'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {api} from '../lib/api'
import type {Container, LogEntry} from '../types'
import {useContainerStatusStream} from '../hooks/useContainerStatusStream'
import {formatInstanceLabel} from '../lib/time'
import {Button} from './ui/button'
import {Input} from './ui/input'
import {Badge} from './ui/badge'
import {Select} from './ui/select'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger,} from './ui/drawer'
import {LogEntryView} from './LogEntry'
import {GroupPanel} from './GroupPanel'
import {InlineGroup} from './InlineGroup'
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
    const {id: containerId} = useParams<{ id: string }>()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    
    // Filters
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [level, setLevel] = useState('')
    const [instanceId, setInstanceId] = useState('')
    const [autoScroll, setAutoScroll] = useState(true)
    const [paused, setPaused] = useState(false)
    const [reverseOrder, setReverseOrder] = useState(false)
    const [showGroupPanel, setShowGroupPanel] = useState(false)
    const [showScrollTop, setShowScrollTop] = useState(false)
    const [groupField, setGroupField] = useState('level')
    const [inlineGrouping, setInlineGrouping] = useState(false)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
    const [envDrawerOpen, setEnvDrawerOpen] = useState(false)
    
    const scrollRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const topRef = useRef<HTMLDivElement>(null)
    
    // Data
    const {data: appConfig} = useQuery({
        queryKey: ['app-config'],
        queryFn: () => api.config.get(),
    })
    
    // SSE real-time status updates
    const [sseStatus, setSseStatus] = useState<Partial<Container> | null>(null)
    useContainerStatusStream(containerId, useCallback((data: Record<string, unknown>) => {
        setSseStatus(data as Partial<Container>)
    }, []))

    const {data: instances} = useQuery({
        queryKey: ['instances', containerId],
        queryFn: () => api.containers.instances(containerId!),
        enabled: !!containerId,
        refetchInterval: 5000,
    })
    
    // Auto-switch to new running instance when container restarts
    const prevInstancesRef = useRef<import('../types').ContainerInstance[]>([])
    useEffect(() => {
        if (!instances) return
        
        const prevInstances = prevInstancesRef.current
        prevInstancesRef.current = instances
        
        if (!instanceId) return
        
        const current = instances.find(i => i.id === instanceId)
        const prevCurrent = prevInstances.find(i => i.id === instanceId)
        
        if (current?.status === 'stopped' && prevCurrent?.status === 'running') {
            const running = instances.find(i => i.status === 'running')
            if (running) {
                setInstanceId(running.id)
            }
        }
    }, [instances])
    
    const {data: levels} = useQuery({
        queryKey: ['levels', containerId],
        queryFn: () => api.logs.levels(containerId!),
        enabled: !!containerId,
    })
    
    const {data: logResult, isLoading} = useQuery({
        queryKey: ['logs', containerId, search, level, instanceId],
        queryFn: () => api.logs.query(containerId!, {
            search: search || undefined,
            level: level || undefined,
            instanceId: instanceId || undefined,
            limit: 500,
        }),
        enabled: !!containerId,
        refetchInterval: paused ? false : 3000,
    })
    
    const container = useMemo(() => {
        const base = logResult?.container
        if (!base && !sseStatus) return null
        return {...(base || {}), ...sseStatus} as Container
    }, [logResult?.container, sseStatus])

    const entries = logResult?.entries || []
    
    // Check if any entry has JSON content
    const hasJsonLogs = useMemo(() => entries.some(e => e.isJson), [entries])
    
    // Reverse order entries
    const displayEntries = useMemo(() =>
            reverseOrder ? [...entries].reverse() : entries,
        [entries, reverseOrder]
    )
    
    // Group entries by field for inline grouping
    const groupedEntries = useMemo(() => {
        if (!inlineGrouping || !groupField) return null
        const groups: { key: string; entries: LogEntry[] }[] = []
        let currentKey: string | null = null
        let currentEntries: LogEntry[] = []
        
        for (const entry of displayEntries) {
            let fieldValue = '(none)'
            if (entry.isJson && entry.parsedJson) {
                try {
                    const parsed = JSON.parse(entry.parsedJson)
                    const val = parsed[groupField]
                    fieldValue = val != null ? String(val) : '(none)'
                } catch { /* use default */
                }
            }
            
            if (fieldValue !== currentKey) {
                if (currentEntries.length > 0) {
                    groups.push({key: currentKey!, entries: currentEntries})
                }
                currentKey = fieldValue
                currentEntries = [entry]
            } else {
                currentEntries.push(entry)
            }
        }
        if (currentEntries.length > 0) {
            groups.push({key: currentKey!, entries: currentEntries})
        }
        return groups
    }, [displayEntries, inlineGrouping, groupField])
    
    const toggleGroup = useCallback((key: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }, [])
    
    // Auto-scroll
    useEffect(() => {
        if (!autoScroll) return
        if (reverseOrder && topRef.current) {
            topRef.current.scrollIntoView({behavior: 'smooth'})
        } else if (!reverseOrder && bottomRef.current) {
            bottomRef.current.scrollIntoView({behavior: 'smooth'})
        }
    }, [logResult?.entries, autoScroll, reverseOrder])
    
    // Track scroll position to show/hide scroll-to-top button
    const handleScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        setShowScrollTop(el.scrollTop > 300)
    }, [])
    
    const scrollToTop = useCallback(() => {
        scrollRef.current?.scrollTo({top: 0, behavior: 'smooth'})
    }, [])
    
    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        setSearch(searchInput)
    }
    
    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
            {/* Header */}
            <div className="border-b px-4 py-3">
                <div className="flex items-center gap-3 mb-3">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
                        <ArrowLeft className="h-4 w-4"/>
                    </Button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-lg font-semibold truncate">
                            {container?.name || containerId}
                        </h1>
                        <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                            <span className="truncate">{container?.image}</span>
                            {container?.stats && (
                                <>
                                    {container.stats.cpuPercent != null && (
                                        <span className="inline-flex items-center gap-0.5 shrink-0">
                      <Cpu className="h-3 w-3"/>
                      <span
                          className={container.stats.cpuPercent > 80 ? 'text-red-500' : container.stats.cpuPercent > 50 ? 'text-amber-500' : 'text-emerald-500'}>
                        {container.stats.cpuPercent}%
                      </span>
                    </span>
                                    )}
                                    {container.stats.memUsage && (
                                        <span className="inline-flex items-center gap-0.5 shrink-0">
                      <MemoryStick className="h-3 w-3"/>
                      <span
                          className={(container.stats.memPercent ?? 0) > 80 ? 'text-red-500' : (container.stats.memPercent ?? 0) > 50 ? 'text-amber-500' : 'text-emerald-500'}>
                        {container.stats.memPercent != null ? `${container.stats.memUsage} (${container.stats.memPercent}%)` : container.stats.memUsage}
                      </span>
                    </span>
                                    )}
                                    {(container.stats.diskRead || container.stats.diskWrite) && (
                                        <span className="inline-flex items-center gap-0.5 shrink-0">
                      <HardDrive className="h-3 w-3"/>
                                            {[container.stats.diskRead && `R ${container.stats.diskRead}`, container.stats.diskWrite && `W ${container.stats.diskWrite}`].filter(Boolean).join(' / ')}
                    </span>
                                    )}
                                </>
                            )}
                            {container?.health && (
                                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <Heart
                      className={`h-3 w-3 ${container.health === 'healthy' ? 'text-emerald-500' : container.health === 'unhealthy' ? 'text-red-500' : 'text-amber-500'}`}/>
                  <span
                      className={container.health === 'healthy' ? 'text-emerald-500' : container.health === 'unhealthy' ? 'text-red-500' : 'text-amber-500'}>{container.health}</span>
                </span>
                            )}
                            {container?.pid != null && container.pid > 0 && (
                                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <Hash className="h-3 w-3"/>PID: {container.pid}
                </span>
                            )}
                            {container?.uptime && (
                                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <Clock className="h-3 w-3"/>Up: {container.uptime}
                </span>
                            )}
                            {container?.state !== 'running' && container?.exitCode != null && (
                                <span className="inline-flex items-center gap-0.5 shrink-0">
                  Exit: {container.exitCode}
                </span>
                            )}
                            {(container?.restartCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <RotateCcw className="h-3 w-3"/>{container?.restartCount}
                </span>
                            )}
                            {container?.networks && container.networks.length > 0 && (
                                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <Network className="h-3 w-3"/>{container.networks.join(', ')}
                </span>
                            )}
                            {container?.restartPolicy && (
                                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <Shield className="h-3 w-3"/>{container.restartPolicy}
                </span>
                            )}
                        </div>
                    </div>
                    <Drawer direction="right" open={envDrawerOpen} onOpenChange={setEnvDrawerOpen}>
                        <DrawerTrigger asChild>
                            <Button variant="ghost" size="sm" title="Environment Variables">
                                <Braces className="h-4 w-4"/>
                                Env
                            </Button>
                        </DrawerTrigger>
                        <DrawerContent>
                            <DrawerHeader>
                                <DrawerTitle>Environment Variables</DrawerTitle>
                                <DrawerDescription>
                                    {container?.name || containerId}
                                </DrawerDescription>
                            </DrawerHeader>
                            <div className="flex-1 overflow-auto px-4 pb-4">
                                {container?.env && container.env.length > 0 ? (
                                    <div className="space-y-1">
                                        {container.env.map((line, i) => {
                                            const eqIndex = line.indexOf('=')
                                            const key = eqIndex >= 0 ? line.slice(0, eqIndex) : line
                                            const value = eqIndex >= 0 ? line.slice(eqIndex + 1) : ''
                                            return (
                                                <div key={i}
                                                     className="group rounded-md border px-3 py-2 text-sm hover:bg-accent/50 transition-colors">
                                                    <div
                                                        className="font-mono text-xs font-medium text-foreground break-all">{key}</div>
                                                    {value && (
                                                        <div
                                                            className="font-mono text-xs text-muted-foreground mt-0.5 break-all select-all">{value}</div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <div
                                        className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                                        No environment variables found.
                                    </div>
                                )}
                            </div>
                        </DrawerContent>
                    </Drawer>
                    <Badge variant={container?.state === 'running' ? 'success' : 'soft-destructive'}>
                        {container?.state || 'unknown'}
                    </Badge>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPaused(!paused)}
                    >
                        {paused ? <Play className="h-4 w-4"/> : <Pause className="h-4 w-4"/>}
                        {paused ? 'Resume' : 'Pause'}
                    </Button>
                </div>
                
                {/* Filters - full width */}
                <div className="flex items-center gap-2 w-full">
                    <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-[200px]">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/>
                            <Input
                                value={searchInput}
                                onChange={e => setSearchInput(e.target.value)}
                                placeholder="Search logs..."
                                className="pl-9 h-9"
                            />
                        </div>
                        <Button type="submit" size="sm" variant="outline">Search</Button>
                        {search && (
                            <Button size="sm" variant="ghost" onClick={() => {
                                setSearch('');
                                setSearchInput('')
                            }}>
                                Clear
                            </Button>
                        )}
                    </form>
                    
                    <Select
                        value={level}
                        onChange={e => setLevel(e.target.value)}
                        options={(levels || []).map(l => ({value: l, label: l}))}
                        placeholder="All levels"
                        className="w-36"
                    />
                    
                    <Select
                        value={instanceId}
                        onChange={e => setInstanceId(e.target.value)}
                        options={(instances || []).map(inst => ({
                            value: inst.id,
                            label: formatInstanceLabel(inst.startedAt, inst.status, appConfig?.timezone),
                        }))}
                        placeholder="All instances"
                        className="w-64"
                    />
                    
                    <Button
                        variant={reverseOrder ? 'default' : 'ghost'}
                        size="icon"
                        onClick={() => setReverseOrder(!reverseOrder)}
                        title={reverseOrder ? '正向排序（旧→新）' : '反向排序（新→旧）'}
                    >
                        <ArrowUpDown className="h-4 w-4"/>
                    </Button>
                    
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setAutoScroll(!autoScroll)}
                        title={autoScroll ? '自动滚动：点击关闭' : '自动滚动：点击开启'}
                    >
                        {reverseOrder ? (
                            <ArrowUpIcon
                                className={`h-4 w-4 ${autoScroll ? 'text-primary' : 'text-muted-foreground'}`}/>
                        ) : (
                            <ArrowDown className={`h-4 w-4 ${autoScroll ? 'text-primary' : 'text-muted-foreground'}`}/>
                        )}
                    </Button>
                    
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => queryClient.invalidateQueries({queryKey: ['logs', containerId]})}
                        title="手动刷新日志"
                    >
                        <RefreshCw className="h-4 w-4"/>
                    </Button>
                </div>
                
                {/* Group by field (only for JSON logs) */}
                {hasJsonLogs && (
                    <div className="mt-2">
                        <button
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setShowGroupPanel(!showGroupPanel)}
                        >
                            {showGroupPanel ? <ChevronDown className="h-3.5 w-3.5"/> :
                                <ChevronRight className="h-3.5 w-3.5"/>}
                            <Group className="h-3.5 w-3.5"/>
                            Group by field
                        </button>
                        {showGroupPanel && (
                            <div className="mt-2">
                                <GroupPanel
                                    containerId={containerId!}
                                    instanceId={instanceId}
                                    field={groupField}
                                    onFieldChange={setGroupField}
                                    inlineGrouping={inlineGrouping}
                                    onInlineToggle={() => setInlineGrouping(!inlineGrouping)}
                                />
                            </div>
                        )}
                    </div>
                )}
                
                {/* Stats */}
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>{logResult?.total ?? 0} log entries</span>
                    {search && <span>Filtered by: "{search}"</span>}
                    {level && <span>Level: {level}</span>}
                </div>
            </div>
            
            {/* Log content */}
            <div className="flex-1 overflow-hidden relative">
                <div
                    ref={scrollRef}
                    className="h-full overflow-auto px-2 py-2"
                    onScroll={handleScroll}
                >
                    <div ref={topRef}/>
                    
                    {isLoading && entries.length === 0 && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <RefreshCw className="h-5 w-5 animate-spin mr-2"/>
                            Loading logs...
                        </div>
                    )}
                    
                    {!isLoading && entries.length === 0 && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            No logs yet. Wait for logs to be collected...
                        </div>
                    )}
                    
                    {inlineGrouping && groupedEntries ? (
                        <div>
                            {groupedEntries.map((group, gi) => (
                                <InlineGroup
                                    key={`${group.key}-${gi}`}
                                    groupKey={group.key}
                                    colorIndex={gi}
                                    count={group.entries.length}
                                    collapsed={collapsedGroups.has(`${gi}`)}
                                    onToggle={() => toggleGroup(`${gi}`)}
                                >
                                    <div className="space-y-0.5">
                                        {group.entries.map((entry, i) => (
                                            <LogEntryView key={entry.id || `${gi}-${i}`} entry={entry}
                                                          timezone={appConfig?.timezone}/>
                                        ))}
                                    </div>
                                </InlineGroup>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {displayEntries.map((entry, i) => (
                                <LogEntryView key={entry.id || i} entry={entry} timezone={appConfig?.timezone}/>
                            ))}
                        </div>
                    )}
                    <div ref={bottomRef}/>
                </div>
                
                {/* Scroll to top floating button */}
                {showScrollTop && (
                    <button
                        onClick={scrollToTop}
                        className="fixed bottom-6 right-6 z-50 h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 flex items-center justify-center transition-opacity"
                        title="回到顶部"
                    >
                        <ArrowUpIcon className="h-5 w-5"/>
                    </button>
                )}
            </div>
        </div>
    )
}
