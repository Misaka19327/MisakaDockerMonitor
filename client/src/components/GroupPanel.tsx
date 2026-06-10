import {Input} from './ui/input'
import {Button} from './ui/button'
import {Badge} from './ui/badge'

interface GroupPanelProps {
    field: string
    groups: { value: string; count: number }[]
    onFieldChange: (field: string) => void
    inlineGrouping: boolean
    onInlineToggle: () => void
}

export function GroupPanel({
                               field, groups, onFieldChange, inlineGrouping, onInlineToggle,
                           }: GroupPanelProps) {
    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <Input
                    value={field}
                    onChange={e => onFieldChange(e.target.value)}
                    placeholder="键名 (e.g., level, path, caller)"
                    className="w-64 h-8 text-xs"
                />
                <Button size="sm" variant="outline" className="h-8 text-xs" disabled>Group</Button>
                <Button
                    size="sm"
                    variant={inlineGrouping ? 'default' : 'outline'}
                    className="h-8 text-xs"
                    onClick={onInlineToggle}
                    title={inlineGrouping ? '在日志列表内展示分组' : '切换为内联分组模式'}
                >
                    Inline
                </Button>
            </div>
            
            {inlineGrouping ? (
                <p className="text-xs text-muted-foreground">
                    内联分组已启用 — 日志列表按 "{field}" 分组展示
                </p>
            ) : (
                <>
                    {groups.length > 0 && (
                        <div className="space-y-0.5 max-h-48 overflow-auto">
                            {groups.map((g, i) => (
                                <div key={i}
                                     className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 text-xs">
                                    <Badge variant="secondary" className="font-mono text-[10px] max-w-xs truncate">
                                        {g.value}
                                    </Badge>
                                    <div className="flex-1">
                                        <div className="h-1.5 bg-primary/20 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-primary rounded-full"
                                                style={{width: `${Math.max(2, (g.count / (groups[0]?.count || 1)) * 100)}%`}}
                                            />
                                        </div>
                                    </div>
                                    <span className="text-muted-foreground tabular-nums">{g.count}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {groups.length === 0 && (
                        <p className="text-xs text-muted-foreground">No groups found for field "{field}"</p>
                    )}
                </>
            )}
        </div>
    )
}
