import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { LogEntry, ContainerInstance } from '../types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Select } from './ui/select'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { LogEntryView } from './LogEntry'
import { GroupPanel } from './GroupPanel'
import {
  ArrowLeft, Search, RefreshCw, ChevronDown, Filter,
  Pause, Play, ArrowDown,
} from 'lucide-react'

export function LogViewer() {
  const { id: containerId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Filters
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [level, setLevel] = useState('')
  const [instanceId, setInstanceId] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [paused, setPaused] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Data
  const { data: container } = useQuery({
    queryKey: ['container', containerId],
    queryFn: () => api.containers.get(containerId!),
    enabled: !!containerId,
  })

  const { data: instances } = useQuery({
    queryKey: ['instances', containerId],
    queryFn: () => api.containers.instances(containerId!),
    enabled: !!containerId,
  })

  const { data: levels } = useQuery({
    queryKey: ['levels', containerId],
    queryFn: () => api.logs.levels(containerId!),
    enabled: !!containerId,
  })

  const { data: logResult, isLoading } = useQuery({
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

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logResult?.entries, autoScroll])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  const entries = logResult?.entries || []

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {container?.name || containerId}
            </h1>
            <p className="text-xs text-muted-foreground">{container?.image}</p>
          </div>
          <Badge variant={container?.state === 'running' ? 'success' : 'destructive'}>
            {container?.state || 'unknown'}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search logs..."
                className="pl-9 h-9"
              />
            </div>
            <Button type="submit" size="sm" variant="outline">Search</Button>
            {search && (
              <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setSearchInput('') }}>
                Clear
              </Button>
            )}
          </form>

          <Select
            value={level}
            onChange={e => setLevel(e.target.value)}
            options={(levels || []).map(l => ({ value: l, label: l }))}
            placeholder="All levels"
            className="w-36"
          />

          <Select
            value={instanceId}
            onChange={e => setInstanceId(e.target.value)}
            options={(instances || []).map(inst => ({
              value: inst.id,
              label: `${inst.startedAt.substring(0, 19).replace('T', ' ')}${inst.status === 'running' ? ' (running)' : ''}`,
            }))}
            placeholder="All instances"
            className="w-52"
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
          >
            <ArrowDown className={`h-4 w-4 ${autoScroll ? 'text-primary' : 'text-muted-foreground'}`} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['logs', containerId] })}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <span>{logResult?.total ?? 0} log entries</span>
          {search && <span>Filtered by: "{search}"</span>}
          {level && <span>Level: {level}</span>}
        </div>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="logs">
          <div className="px-4 pt-2">
            <TabsList>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="groups">Groups</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="logs">
            <div ref={scrollRef} className="h-full overflow-auto px-2 py-2">
              {isLoading && entries.length === 0 && (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                  Loading logs...
                </div>
              )}

              {!isLoading && entries.length === 0 && (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                  No logs yet. Wait for logs to be collected...
                </div>
              )}

              <div className="space-y-0.5">
                {entries.map((entry, i) => (
                  <LogEntryView key={entry.id || i} entry={entry} />
                ))}
              </div>
              <div ref={bottomRef} />
            </div>
          </TabsContent>

          <TabsContent value="groups">
            <div className="p-4">
              <GroupPanel containerId={containerId!} instanceId={instanceId} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
