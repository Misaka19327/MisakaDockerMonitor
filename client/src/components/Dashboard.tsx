import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { Container } from '../types'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Container as ContainerIcon, Eye, EyeOff, Play, Square, RefreshCw } from 'lucide-react'

function stateColor(state: string) {
  switch (state) {
    case 'running': return 'success'
    case 'exited': return 'destructive'
    case 'paused': return 'warning'
    default: return 'secondary'
  }
}

export function Dashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: containers, isLoading, refetch } = useQuery({
    queryKey: ['containers'],
    queryFn: () => api.containers.list(),
    refetchInterval: 10000,
  })

  const watchMutation = useMutation({
    mutationFn: (id: string) => api.containers.watch(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['containers'] }),
  })

  const unwatchMutation = useMutation({
    mutationFn: (id: string) => api.containers.unwatch(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['containers'] }),
  })

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Containers</h1>
          <p className="text-muted-foreground">Monitor Docker container logs</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <RefreshCw className="h-6 w-6 animate-spin mr-2" />
          Loading containers...
        </div>
      )}

      {!isLoading && containers?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <ContainerIcon className="h-12 w-12 mb-4 opacity-50" />
            <p>No containers found. Make sure Docker is running.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {containers?.map((c: Container) => (
          <Card key={c.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate" title={c.name}>
                    {c.name}
                  </CardTitle>
                  <CardDescription className="truncate text-xs mt-1">
                    {c.image}
                  </CardDescription>
                </div>
                <Badge variant={stateColor(c.state) as any} className="ml-2 shrink-0">
                  {c.state}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">{c.status}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={c.watched ? 'outline' : 'default'}
                  onClick={() => c.watched ? unwatchMutation.mutate(c.id) : watchMutation.mutate(c.id)}
                  disabled={watchMutation.isPending || unwatchMutation.isPending}
                >
                  {c.watched ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      Unwatch
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      Watch
                    </>
                  )}
                </Button>
                {c.watched && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/container/${c.id}`)}>
                    View Logs
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
