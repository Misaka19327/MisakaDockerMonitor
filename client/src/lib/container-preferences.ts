export interface ContainerPreference {
    starred?: boolean
    lastOpenedAt?: string
}

export type ContainerPreferences = Record<string, ContainerPreference>

const STORAGE_KEY = 'misaka-docker-monitor:container-preferences'

export function loadContainerPreferences(): ContainerPreferences {
    if (typeof window === 'undefined') return {}

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return isPreferencesRecord(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

export function updateContainerStarred(
    preferences: ContainerPreferences,
    containerId: string,
    starred: boolean,
): ContainerPreferences {
    return writePreferences({
        ...preferences,
        [containerId]: {
            ...preferences[containerId],
            starred,
        },
    })
}

export function markContainerOpened(
    containerId: string,
    openedAt = new Date().toISOString(),
): ContainerPreferences {
    const preferences = loadContainerPreferences()
    return writePreferences({
        ...preferences,
        [containerId]: {
            ...preferences[containerId],
            lastOpenedAt: openedAt,
        },
    })
}

function writePreferences(preferences: ContainerPreferences): ContainerPreferences {
    const normalized = normalizePreferences(preferences)

    if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    }

    return normalized
}

function normalizePreferences(preferences: ContainerPreferences): ContainerPreferences {
    return Object.fromEntries(
        Object.entries(preferences).flatMap(([containerId, preference]) => {
            const starred = preference?.starred === true
            const lastOpenedAt = typeof preference?.lastOpenedAt === 'string' ? preference.lastOpenedAt : undefined
            if (!starred && !lastOpenedAt) return []
            return [[containerId, {starred, lastOpenedAt}]]
        }),
    )
}

function isPreferencesRecord(value: unknown): value is ContainerPreferences {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    return Object.values(value).every(isPreference)
}

function isPreference(value: unknown): value is ContainerPreference {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const preference = value as ContainerPreference
    return (
        (preference.starred === undefined || typeof preference.starred === 'boolean') &&
        (preference.lastOpenedAt === undefined || typeof preference.lastOpenedAt === 'string')
    )
}
