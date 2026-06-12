import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {api} from '../lib/api'
import {type ContainerPreferences, loadContainerPreferences, updateContainerStarred} from '../lib/container-preferences'
import type {Container} from '../types'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from './ui/card'
import {Button} from './ui/button'
import {Badge} from './ui/badge'
import {
    Clock,
    Container as ContainerIcon,
    Cpu,
    Eye,
    EyeOff,
    HardDrive,
    MemoryStick,
    RefreshCw,
    Star
} from 'lucide-react'
import {useUiPreferences} from '../lib/ui-preferences'

function stateColor(state: string) {
    switch (state) {
        case 'running':
            return 'success'
        case 'exited':
            return 'soft-destructive'
        case 'paused':
            return 'warning'
        case 'dead':
            return 'soft-destructive'
        default:
            return 'secondary'
    }
}

function ContainerStatsBar({stats}: { stats: Container['stats'] }) {
    if (!stats) return null
    
    const items: { icon: React.ReactNode; label: string; value: string; color?: string }[] = []
    
    if (stats.cpuPercent !== null) {
        const color = stats.cpuPercent > 80 ? 'text-red-500' : stats.cpuPercent > 50 ? 'text-amber-500' : 'text-emerald-500'
        items.push({icon: <Cpu className="h-3 w-3"/>, label: 'CPU', value: `${stats.cpuPercent}%`, color})
    }
    if (stats.memUsage) {
        const color = (stats.memPercent ?? 0) > 80 ? 'text-red-500' : (stats.memPercent ?? 0) > 50 ? 'text-amber-500' : 'text-emerald-500'
        items.push({
            icon: <MemoryStick className="h-3 w-3"/>,
            label: 'MEM',
            value: stats.memPercent !== null ? `${stats.memUsage} (${stats.memPercent}%)` : stats.memUsage,
            color,
        })
    }
    if (stats.diskRead || stats.diskWrite) {
        const parts: string[] = []
        if (stats.diskRead) parts.push(`R ${stats.diskRead}`)
        if (stats.diskWrite) parts.push(`W ${stats.diskWrite}`)
        items.push({icon: <HardDrive className="h-3 w-3"/>, label: 'DISK', value: parts.join(' / ')})
    }
    if (stats.uptime) {
        items.push({icon: <Clock className="h-3 w-3"/>, label: 'UP', value: stats.uptime})
    }
    
    if (items.length === 0) return null
    
    return (
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
            {items.map((item, i) => (
                <span key={i} className="inline-flex items-center gap-1">
          {item.icon}
                    <span className={item.color}>{item.value}</span>
        </span>
            ))}
        </div>
    )
}

type ContainerGroup = {
    key: string
    title: string
    description: string
    containers: Container[]
}

function sortContainers(containers: Container[], preferences: ContainerPreferences): Container[] {
    return [...containers].sort((left, right) => {
        const leftPreference = preferences[left.id]
        const rightPreference = preferences[right.id]
        const leftStarred = leftPreference?.starred === true
        const rightStarred = rightPreference?.starred === true

        if (leftStarred !== rightStarred) {
            return leftStarred ? -1 : 1
        }

        if (leftStarred && rightStarred) {
            const leftLastOpened = leftPreference?.lastOpenedAt ? Date.parse(leftPreference.lastOpenedAt) : 0
            const rightLastOpened = rightPreference?.lastOpenedAt ? Date.parse(rightPreference.lastOpenedAt) : 0
            if (leftLastOpened !== rightLastOpened) {
                return rightLastOpened - leftLastOpened
            }
        }

        return left.name.localeCompare(right.name)
    })
}

function buildContainerGroups(
    containers: Container[],
    preferences: ContainerPreferences,
    t: (key: string) => string,
): ContainerGroup[] {
    return [
        {
            key: 'watched-running',
            title: t('dashboard.group.watchedRunning.title'),
            description: t('dashboard.group.watchedRunning.description'),
            match: (container: Container) => container.watched && container.state === 'running',
        },
        {
            key: 'watched-idle',
            title: t('dashboard.group.watchedIdle.title'),
            description: t('dashboard.group.watchedIdle.description'),
            match: (container: Container) => container.watched && container.state !== 'running',
        },
        {
            key: 'unwatched-running',
            title: t('dashboard.group.unwatchedRunning.title'),
            description: t('dashboard.group.unwatchedRunning.description'),
            match: (container: Container) => !container.watched && container.state === 'running',
        },
        {
            key: 'unwatched-idle',
            title: t('dashboard.group.unwatchedIdle.title'),
            description: t('dashboard.group.unwatchedIdle.description'),
            match: (container: Container) => !container.watched && container.state !== 'running',
        },
    ]
        .map(group => ({
            key: group.key,
            title: group.title,
            description: group.description,
            containers: sortContainers(containers.filter(group.match), preferences),
        }))
        .filter(group => group.containers.length > 0)
}

export function Dashboard() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const {t} = useUiPreferences()
    const [preferences, setPreferences] = useState<ContainerPreferences>(() => loadContainerPreferences())
    
    const {data: containers, isLoading, refetch} = useQuery({
        queryKey: ['containers'],
        queryFn: () => api.containers.list(),
        refetchInterval: 15000,
    })
    
    const watchMutation = useMutation({
        mutationFn: (id: string) => api.containers.watch(id),
        onSuccess: () => queryClient.invalidateQueries({queryKey: ['containers']}),
    })
    
    const unwatchMutation = useMutation({
        mutationFn: (id: string) => api.containers.unwatch(id),
        onSuccess: () => queryClient.invalidateQueries({queryKey: ['containers']}),
    })
    
    const groups = buildContainerGroups(containers || [], preferences, t)
    
    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
                    <p className="text-muted-foreground">{t('dashboard.description')}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                    <RefreshCw className="h-4 w-4"/>
                    {t('action.refresh')}
                </Button>
            </div>
            
            {isLoading && (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mr-2"/>
                    {t('dashboard.loading')}
                </div>
            )}
            
            {!isLoading && containers?.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <ContainerIcon className="h-12 w-12 mb-4 opacity-50"/>
                        <p>{t('dashboard.empty')}</p>
                    </CardContent>
                </Card>
            )}
            
            <div className="space-y-8">
                {groups.map(group => (
                    <section key={group.key} className="space-y-3">
                        <div className="flex items-end justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold">{group.title}</h2>
                                <p className="text-sm text-muted-foreground">{group.description}</p>
                            </div>
                            <Badge variant="secondary">{group.containers.length}</Badge>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {group.containers.map((c: Container) => {
                                const starred = preferences[c.id]?.starred === true

                                return (
                                    <Card key={c.id} className="hover:shadow-md transition-shadow">
                                        <CardHeader className="pb-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <CardTitle className="text-base truncate" title={c.name}>
                                                            {c.name}
                                                        </CardTitle>
                                                        {starred && (
                                                            <Badge variant="secondary" className="shrink-0">
                                                                {t('dashboard.pinned')}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <CardDescription className="truncate text-xs mt-1">
                                                        {c.image}
                                                    </CardDescription>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Button
                                                        type="button"
                                                        size="icon"
                                                        variant="ghost"
                                                        className={starred ? 'text-amber-500 hover:text-amber-500' : 'text-muted-foreground'}
                                                        onClick={() => setPreferences(prev => updateContainerStarred(prev, c.id, !starred))}
                                                        title={starred ? t('dashboard.unpin') : t('dashboard.pin')}
                                                    >
                                                        <Star className={`h-4 w-4 ${starred ? 'fill-current' : ''}`}/>
                                                    </Button>
                                                    <Badge variant={stateColor(c.state) as any}>
                                                        {c.state}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-xs text-muted-foreground mb-2">{c.status}</p>
                                            <div className="min-h-[20px]">
                                                <ContainerStatsBar stats={c.stats}/>
                                            </div>
                                            <div className="grid grid-cols-[1fr_1fr] gap-2 mt-3">
                                                <Button
                                                    size="sm"
                                                    variant={c.watched ? 'outline' : 'default'}
                                                    onClick={() => c.watched ? unwatchMutation.mutate(c.id) : watchMutation.mutate(c.id)}
                                                    disabled={watchMutation.isPending || unwatchMutation.isPending}
                                                    className="w-full"
                                                >
                                                    {c.watched ? (
                                                        <>
                                                            <EyeOff className="h-3.5 w-3.5"/>
                                                            {t('dashboard.unwatch')}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Eye className="h-3.5 w-3.5"/>
                                                            {t('dashboard.watch')}
                                                        </>
                                                    )}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => navigate(`/container/${c.id}`)}
                                                    className={`w-full ${!c.watched ? 'invisible pointer-events-none' : ''}`}
                                                >
                                                    {t('dashboard.viewLogs')}
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    )
}
