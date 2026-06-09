import {memo} from 'react'
import {ChevronDown, ChevronRight} from 'lucide-react'

const GROUP_COLORS = [
    {text: 'text-blue-500', bg: 'bg-blue-500'},
    {text: 'text-emerald-500', bg: 'bg-emerald-500'},
    {text: 'text-amber-500', bg: 'bg-amber-500'},
    {text: 'text-rose-500', bg: 'bg-rose-500'},
    {text: 'text-purple-500', bg: 'bg-purple-500'},
    {text: 'text-cyan-500', bg: 'bg-cyan-500'},
    {text: 'text-orange-500', bg: 'bg-orange-500'},
    {text: 'text-pink-500', bg: 'bg-pink-500'},
]

interface InlineGroupProps {
    groupKey: string
    colorIndex: number
    count: number
    collapsed: boolean
    onToggle: () => void
    children: React.ReactNode
}

export const InlineGroup = memo(function InlineGroup({
                                                         groupKey, colorIndex, count, collapsed, onToggle, children,
                                                     }: InlineGroupProps) {
    const color = GROUP_COLORS[colorIndex % GROUP_COLORS.length]
    
    return (
        <div className="flex">
            {/* Left brace column */}
            <div
                className="relative flex-shrink-0 w-8 cursor-pointer group/brace select-none"
                onClick={onToggle}
                title={`${groupKey} (${count}) — click to ${collapsed ? 'expand' : 'collapse'}`}
            >
                {/* Vertical colored line */}
                <div
                    className={`absolute left-[7px] top-0 bottom-0 w-[2px] ${color.bg} opacity-30 group-hover/brace:opacity-60 transition-opacity`}
                />
                
                {/* Group label */}
                <div
                    className={`sticky top-0 z-10 ${color.text} text-[10px] font-medium leading-tight pt-1 pl-1 truncate max-w-[32px]`}
                    title={groupKey}>
                    {collapsed ? <ChevronRight className="inline h-3 w-3 -ml-0.5 mr-0.5"/> :
                        <ChevronDown className="inline h-3 w-3 -ml-0.5 mr-0.5"/>}
                    <span className="font-mono">{groupKey}</span>
                </div>
                
                {/* Count at bottom when collapsed */}
                {collapsed && (
                    <div className="text-[9px] text-muted-foreground tabular-nums pl-1 mt-1">
                        {count}
                    </div>
                )}
            </div>
            
            {/* Content area */}
            <div className="flex-1 min-w-0">
                {collapsed ? null : children}
            </div>
        </div>
    )
})
