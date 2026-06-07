import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Group } from 'lucide-react'

export function GroupPanel({ containerId, instanceId }: { containerId: string; instanceId?: string }) {
  const [field, setField] = useState('level')

  const { data: groupResult, isLoading, refetch } = useQuery({
    queryKey: ['group', containerId, field, instanceId],
    queryFn: () => api.logs.group(containerId, field, instanceId),
    enabled: !!field,
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Group className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-sm font-medium">Group by Field</h3>
        <div className="flex items-center gap-2 ml-4">
          <Input
            value={field}
            onChange={e => setField(e.target.value)}
            placeholder="JSON field name (e.g., level, path, caller)"
            className="w-72 h-9"
          />
          <Button size="sm" onClick={() => refetch()}>Group</Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading groups...</p>}

      {groupResult && groupResult.groups.length > 0 && (
        <div className="space-y-1">
          {groupResult.groups.map((g, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-muted/50">
              <Badge variant="secondary" className="font-mono text-xs max-w-md truncate">
                {g.value}
              </Badge>
              <div className="flex-1">
                <div
                  className="h-2 bg-primary/20 rounded-full overflow-hidden"
                >
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.max(2, (g.count / (groupResult.groups[0]?.count || 1)) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="text-sm text-muted-foreground tabular-nums">{g.count}</span>
            </div>
          ))}
        </div>
      )}

      {groupResult && groupResult.groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No groups found for field "{field}"</p>
      )}
    </div>
  )
}
