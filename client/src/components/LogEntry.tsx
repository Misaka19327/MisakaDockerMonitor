import {useCallback, useEffect, useRef, useState} from 'react'
import {Badge} from './ui/badge'
import {SqlView} from './SqlView'
import {ChevronDown, ChevronRight} from 'lucide-react'
import {formatTimestamp} from '../lib/time'
import type {ResolvedLogEntry} from '../lib/log-entry'
import {summarizeSql} from '../lib/sql-summary'
import {useUiPreferences} from '../lib/ui-preferences'
import {copyToClipboard} from '../lib/clipboard'
import {toast} from 'sonner'

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

function useSingleAndDoubleClick(singleClick: () => void, doubleClick: () => void) {
    const clickTimerRef = useRef<number | null>(null)

    useEffect(() => () => {
        if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current)
    }, [])

    const handleClick = useCallback(() => {
        if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current)
        clickTimerRef.current = window.setTimeout(() => {
            singleClick()
            clickTimerRef.current = null
        }, 180)
    }, [singleClick])

    const handleDoubleClick = useCallback(() => {
        if (clickTimerRef.current != null) {
            window.clearTimeout(clickTimerRef.current)
            clickTimerRef.current = null
        }
        doubleClick()
    }, [doubleClick])

    return {handleClick, handleDoubleClick}
}

function JsonLogEntry({entry, expanded, onToggle, showSql, onToggleSql, timezone}: {
    entry: ResolvedLogEntry
    expanded: boolean
    onToggle: () => void
    showSql: boolean
    onToggleSql: () => void
    timezone?: string
}) {
    const {t} = useUiPreferences()
    const parsed = entry.derivedFields ?? {}
    const sqlSummary = entry.sql ? summarizeSql(entry.sql) : null
    
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
    const copyRawLog = useCallback(async () => {
        const copied = await copyToClipboard(entry.rawContent ?? entry.content ?? '')
        if (copied) toast.success(t('viewer.copy.copied'))
        else toast.error(t('viewer.copy.failed'))
    }, [entry.content, entry.rawContent, t])
    const {handleClick: handleToggleClick, handleDoubleClick: handleCopyDoubleClick} = useSingleAndDoubleClick(onToggle, copyRawLog)
    
    return (
        <div className="group rounded hover:bg-muted/50 transition-colors">
            <div className="log-entry-row px-2 py-1">
                <button
                    type="button"
                    title={expanded ? t('inline.toggle.collapse') : t('inline.toggle.expand')}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    onClick={onToggle}
                >
                    {expanded ? <ChevronDown className="h-3.5 w-3.5"/> : <ChevronRight className="h-3.5 w-3.5"/>}
                </button>
                <span className="log-entry-line">{entry.lineNumber}</span>
                {timestamp ? (
                    <span className="log-entry-timestamp">{formatTimestamp(timestamp, timezone)}</span>
                ) : (
                    <span className="log-entry-timestamp">&nbsp;</span>
                )}
                <div
                    className="log-entry-main cursor-pointer select-none"
                    onClick={handleToggleClick}
                    onDoubleClick={handleCopyDoubleClick}
                >
                    <div className="log-entry-prefix">
                        {level && <Badge variant={levelVariant(level)}
                                         className="log-entry-level-badge shrink-0">{level}</Badge>}
                        {caller && <span className="log-entry-meta log-entry-caller truncate max-w-48">{caller}</span>}
                        {method && path && (
                            <span className="log-entry-meta log-entry-path shrink-0">{method} {path}</span>
                        )}
                    </div>
                    <span className="log-entry-message truncate">{content}</span>
                    {entry.hasSql && (
                        <button
                            type="button"
                            onClick={e => {
                                e.stopPropagation()
                                onToggleSql()
                            }}
                            className="log-entry-sql-chip"
                        >
                            {showSql ? <ChevronDown className="h-3 w-3"/> : <ChevronRight className="h-3 w-3"/>}
                            <span className="log-entry-sql-label">{t('common.sql')}:</span>
                            <span className="log-entry-sql-action">{sqlSummary?.action ?? 'sql'}</span>
                            {sqlSummary?.primaryTable ? (
                                <span className="log-entry-sql-primary">{sqlSummary.primaryTable}</span>
                            ) : (
                                <span className="log-entry-sql-fallback">{t('viewer.sqlSummaryFallback')}</span>
                            )}
                            {sqlSummary && sqlSummary.joinedTables.length > 0 && (
                                <>
                                    {sqlSummary.joinedTables.slice(0, 2).map(table => (
                                        <span key={table} className="log-entry-sql-join">{table}</span>
                                    ))}
                                    {sqlSummary.joinedTables.length > 2 && (
                                        <span className="log-entry-sql-fallback">
                                            {t('viewer.sqlJoinMore', {count: sqlSummary.joinedTables.length - 2})}
                                        </span>
                                    )}
                                </>
                            )}
                        </button>
                    )}
                </div>
                {duration && <span className="log-entry-duration">{duration}</span>}
            </div>
            
            {expanded && (
                <div className="log-entry-row px-2 pb-2">
                    <span className="w-3.5"/>
                    <span className="log-entry-line"/>
                    <span className="log-entry-timestamp"/>
                    <div className="rounded-md border border-border/70 bg-card/70 p-3">
                        <pre className="log-entry-pretty">
                            {JSON.stringify(parsed, null, 2)}
                        </pre>
                        {trace && (
                            <div className="log-entry-meta mt-2 text-muted-foreground">
                                {t('viewer.inlineTrace')}: {trace} {span && `| ${t('viewer.inlineSpan')}: ${span}`}
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {showSql && entry.sql && (
                <div className="log-entry-row px-2 pb-2">
                    <span className="w-3.5"/>
                    <span className="log-entry-line"/>
                    <span className="log-entry-timestamp"/>
                    <div>
                        <SqlView sql={entry.sql}/>
                    </div>
                </div>
            )}
        </div>
    )
}

function TextLogEntry({entry, timezone}: { entry: ResolvedLogEntry; timezone?: string }) {
    const {t} = useUiPreferences()
    const [expanded, setExpanded] = useState(false)
    const raw = entry.rawContent ?? ''
    const isMultiline = raw.includes('\n') || raw.length > 0
    const copyRawLog = useCallback(async () => {
        const copied = await copyToClipboard(raw)
        if (copied) toast.success(t('viewer.copy.copied'))
        else toast.error(t('viewer.copy.failed'))
    }, [raw, t])
    const toggleExpanded = useCallback(() => setExpanded(current => !current), [])
    const {handleClick: handleToggleClick, handleDoubleClick: handleCopyDoubleClick} = useSingleAndDoubleClick(toggleExpanded, copyRawLog)

    return (
        <div className="group rounded hover:bg-muted/50 transition-colors">
            <div className="log-entry-row px-2 py-1">
                {isMultiline ? (
                    <button
                        type="button"
                        title={expanded ? t('inline.toggle.collapse') : t('inline.toggle.expand')}
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        onClick={toggleExpanded}
                    >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5"/> : <ChevronRight className="h-3.5 w-3.5"/>}
                    </button>
                ) : (
                    <span className="w-3.5"/>
                )}
                <span className="log-entry-line">{entry.lineNumber}</span>
                {entry.timestamp ? (
                    <span className="log-entry-timestamp">{formatTimestamp(entry.timestamp, timezone)}</span>
                ) : (
                    <span className="log-entry-timestamp">&nbsp;</span>
                )}
                <div
                    className={`log-entry-main ${isMultiline ? 'cursor-pointer select-none' : ''}`}
                    onClick={isMultiline ? handleToggleClick : undefined}
                    onDoubleClick={handleCopyDoubleClick}
                >
                    <span className="log-entry-message">{raw}</span>
                </div>
            </div>

            {expanded && (
                <div className="log-entry-row px-2 pb-2">
                    <span className="w-3.5"/>
                    <span className="log-entry-line"/>
                    <span className="log-entry-timestamp"/>
                    <div className="rounded-md border border-border/70 bg-card/70 p-3">
                        <pre className="log-entry-text">{raw}</pre>
                    </div>
                </div>
            )}
        </div>
    )
}
