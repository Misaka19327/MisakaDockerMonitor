import {useState} from 'react'
import {Badge} from './ui/badge'
import {SqlView} from './SqlView'
import {ChevronDown, ChevronRight} from 'lucide-react'
import {formatTimestamp} from '../lib/time'
import type {ResolvedLogEntry} from '../lib/log-entry'

function levelVariant(level: string | null): 'default' | 'info' | 'warning' | 'destructive' | 'secondary' {
    if (!level) return 'secondary'
    const l = level.toLowerCase()
    if (l === 'error' || l === 'err' || l === 'fatal' || l === 'panic') return 'destructive'
    if (l === 'warn' || l === 'warning') return 'warning'
    if (l === 'info') return 'info'
    if (l === 'debug') return 'secondary'
    return 'secondary'
}

export function LogEntryView({entry, timezone}: { entry: ResolvedLogEntry; timezone?: string }) {
    const [expanded, setExpanded] = useState(false)
    const [showSql, setShowSql] = useState(false)
    
    if (entry.isJson && entry.parsedJson) {
        return (
            <JsonLogEntry
                entry={entry}
                expanded={expanded}
                onToggle={() => setExpanded(!expanded)}
                showSql={showSql}
                onToggleSql={() => setShowSql(!showSql)}
                timezone={timezone}
            />
        )
    }
    
    return <TextLogEntry entry={entry} timezone={timezone}/>
}

function JsonLogEntry({entry, expanded, onToggle, showSql, onToggleSql, timezone}: {
    entry: ResolvedLogEntry
    expanded: boolean
    onToggle: () => void
    showSql: boolean
    onToggleSql: () => void
    timezone?: string
}) {
    const parsed = entry.derivedFields ?? {}
    
    // Extract common fields for summary line
    const timestamp = entry.timestamp
    const level = entry.level
    const content = entry.content
    const caller = (parsed as any).caller as string | undefined
    const path = (parsed as any).path as string | undefined
    const method = (parsed as any).method as string | undefined
    const duration = (parsed as any).duration as string | undefined
    const span = (parsed as any).span as string | undefined
    const trace = (parsed as any).trace as string | undefined
    
    return (
        <div className="group rounded hover:bg-muted/50 transition-colors">
            {/* Summary line */}
            <div className="flex items-start gap-2 px-2 py-1 cursor-pointer select-none" onClick={onToggle}>
        <span className="shrink-0 mt-0.5">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground"/> :
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground"/>}
        </span>
                <span className="text-xs text-muted-foreground shrink-0 w-8 text-right">{entry.lineNumber}</span>
                {timestamp &&
                    <span className="text-xs text-blue-600 shrink-0">{formatTimestamp(timestamp, timezone)}</span>}
                {level && <Badge variant={levelVariant(level)}
                                 className="shrink-0 text-[10px] px-1.5 py-0 h-4">{level}</Badge>}
                {caller && <span className="text-xs text-purple-600 truncate max-w-48">{caller}</span>}
                {method && path && (
                    <span className="text-xs text-orange-600 shrink-0">{method} {path}</span>
                )}
                <span className="text-xs flex-1 truncate">{content}</span>
                {duration && <span className="text-xs text-muted-foreground shrink-0">{duration}</span>}
                {entry.hasSql && (
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            onToggleSql()
                        }}
                        className="text-xs text-blue-500 hover:text-blue-700 shrink-0 underline"
                    >
                        SQL
                    </button>
                )}
            </div>
            
            {/* Expanded JSON view */}
            {expanded && (
                <div className="ml-12 mr-4 mb-2 p-3 bg-slate-50 rounded-md border">
          <pre className="log-entry-json whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(parsed, null, 2)}
          </pre>
                    {trace && (
                        <div className="mt-2 text-xs text-muted-foreground">
                            trace: {trace} {span && `| span: ${span}`}
                        </div>
                    )}
                </div>
            )}
            
            {/* SQL view */}
            {showSql && entry.sql && (
                <div className="ml-12 mr-4 mb-2">
                    <SqlView sql={entry.sql}/>
                </div>
            )}
        </div>
    )
}

function TextLogEntry({entry, timezone}: { entry: ResolvedLogEntry; timezone?: string }) {
    return (
        <div className="group rounded hover:bg-muted/50 transition-colors">
            <div className="flex items-start gap-2 px-2 py-1">
                <span className="text-xs text-muted-foreground shrink-0 w-8 text-right">{entry.lineNumber}</span>
                {entry.timestamp && (
                    <span className="text-xs text-blue-600 shrink-0">{formatTimestamp(entry.timestamp, timezone)}</span>
                )}
                <pre className="log-entry-text flex-1">{entry.rawContent}</pre>
            </div>
        </div>
    )
}
