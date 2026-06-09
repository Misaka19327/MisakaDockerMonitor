function buildFormatter(timezone?: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
}

export function formatTimestamp(timestamp: string | null, timezone?: string): string {
    if (!timestamp) return ''
    
    try {
        const date = new Date(timestamp)
        if (Number.isNaN(date.getTime())) return timestamp
        return buildFormatter(timezone).format(date)
    } catch {
        return timestamp
    }
}

export function formatInstanceLabel(startedAt: string, status: 'running' | 'stopped', timezone?: string): string {
    const formatted = formatTimestamp(startedAt, timezone)
    if (!formatted) return status === 'running' ? '(running)' : ''
    return `${formatted}${status === 'running' ? ' (running)' : ''}`
}
