import {useEffect, useRef, useState} from 'react'
import {Clock, X} from 'lucide-react'
import {Button} from './ui/button'
import {useUiPreferences} from '../lib/ui-preferences'
import {buildTimePresetRange, type TimePreset, type TimeRange} from '../lib/time'

interface TimeFilterProps {
    value: TimeRange
    onChange: (range: TimeRange) => void
    timezone?: string
    className?: string
}

function describeRange(range: TimeRange, t: (k: string) => string): string {
    if (!range.startTime && !range.endTime) return t('viewer.timeFilter.allTime')
    const start = range.startTime ? range.startTime.replace('T', ' ') : t('viewer.timeFilter.noStart')
    const end = range.endTime ? range.endTime.replace('T', ' ') : t('viewer.timeFilter.noEnd')
    return `${start} ~ ${end}`
}

export function TimeFilter({value, onChange, timezone, className}: TimeFilterProps) {
    const {t} = useUiPreferences()
    const [open, setOpen] = useState(false)
    const [alignRight, setAlignRight] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Local edit buffer so the user can type freely before applying.
    const [draftStart, setDraftStart] = useState(value.startTime ?? '')
    const [draftEnd, setDraftEnd] = useState(value.endTime ?? '')

    useEffect(() => {
        if (!open) {
            setDraftStart(value.startTime ?? '')
            setDraftEnd(value.endTime ?? '')
        }
    }, [open, value])

    useEffect(() => {
        if (!open) return
        function handlePointer(e: MouseEvent) {
            if (!containerRef.current) return
            if (!containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }

        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false)
        }

        document.addEventListener('mousedown', handlePointer)
        document.addEventListener('keydown', handleKey)
        return () => {
            document.removeEventListener('mousedown', handlePointer)
            document.removeEventListener('keydown', handleKey)
        }
    }, [open])

    const hasRange = !!(value.startTime || value.endTime)

    function toggleOpen() {
        if (!open && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect()
            setAlignRight(rect.left + 448 > window.innerWidth)
        }
        setOpen(o => !o)
    }

    function applyPreset(preset: TimePreset) {
        onChange(buildTimePresetRange(preset, timezone))
        setOpen(false)
    }

    function applyCustom() {
        onChange({
            startTime: draftStart || undefined,
            endTime: draftEnd || undefined,
        })
        setOpen(false)
    }

    function clearRange() {
        onChange({})
        setOpen(false)
    }

    const presets: {key: TimePreset; label: string}[] = [
        {key: 'last15m', label: t('viewer.timeFilter.presets.last15m')},
        {key: 'last1h', label: t('viewer.timeFilter.presets.last1h')},
        {key: 'last6h', label: t('viewer.timeFilter.presets.last6h')},
        {key: 'today', label: t('viewer.timeFilter.presets.today')},
        {key: 'yesterday', label: t('viewer.timeFilter.presets.yesterday')},
        {key: 'last7d', label: t('viewer.timeFilter.presets.last7d')},
    ]

    return (
        <div ref={containerRef} className={`relative ${className ?? ''}`}>
            <button
                type="button"
                onClick={toggleOpen}
                className={`flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors hover:bg-accent/50 ${
                    hasRange ? 'border-primary/60 text-foreground' : 'text-muted-foreground'
                } focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
            >
                <Clock className="h-4 w-4 shrink-0"/>
                <span className="whitespace-nowrap">{describeRange(value, t)}</span>
            </button>

            {open && (
                <div
                    className={`absolute z-50 mt-1.5 flex w-[28rem] max-w-[calc(100vw-2rem)] overflow-visible rounded-lg border border-border bg-popover text-popover-foreground shadow-lg ${alignRight ? 'right-0' : 'left-0'}`}>
                    {/* Quick presets */}
                    <div className="w-32 shrink-0 border-r border-border bg-muted/40 py-1.5">
                        {presets.map(p => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => applyPreset(p.key)}
                                className="block w-full px-3 py-1.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent"
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Custom range */}
                    <div className="min-w-0 flex-1 p-3 pr-4">
                        <div className="mb-2 text-xs font-medium text-muted-foreground">
                            {t('viewer.timeFilter.customRange')}
                        </div>
                        <label className="mb-2 block">
                            <span
                                className="mb-1 block text-[11px] text-muted-foreground">{t('viewer.timeFilter.startTime')}</span>
                            <input
                                type="datetime-local"
                                value={draftStart}
                                onChange={e => setDraftStart(e.target.value)}
                                className="flex h-9 w-full min-w-[16rem] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                        </label>
                        <label className="mb-3 block">
                            <span
                                className="mb-1 block text-[11px] text-muted-foreground">{t('viewer.timeFilter.endTime')}</span>
                            <input
                                type="datetime-local"
                                value={draftEnd}
                                onChange={e => setDraftEnd(e.target.value)}
                                className="flex h-9 w-full min-w-[16rem] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                        </label>
                        <div className="flex items-center gap-2">
                            <Button type="button" size="sm" onClick={applyCustom}>
                                {t('viewer.timeFilter.apply')}
                            </Button>
                            {hasRange && (
                                <Button type="button" size="sm" variant="ghost" onClick={clearRange}>
                                    <X className="h-3.5 w-3.5"/>
                                    {t('viewer.timeFilter.clear')}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
