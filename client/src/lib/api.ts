import type {AppConfig, AuthResponse, Container, ContainerInstance, GroupResult, LogQueryResult} from '../types'

const BASE = ''

function getToken(): string | null {
    return localStorage.getItem('token')
}

function authHeaders(): HeadersInit {
    const token = getToken()
    return token ? {Authorization: `Bearer ${token}`} : {}
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${url}`, {
        ...options,
        headers: {
            ...authHeaders(),
            ...options?.headers,
        },
    })

    if (res.status === 401) {
        localStorage.removeItem('token')
        window.location.href = '/login'
        throw new Error('Unauthorized')
    }

    if (!res.ok) {
        const body = await res.json().catch(() => ({error: res.statusText}))
        throw new Error(body.error || res.statusText)
    }

    return res.json()
}

export const api = {
    config: {
        get(): Promise<AppConfig> {
            return request('/api/config')
        },
    },

    auth: {
        login(username: string, password: string): Promise<AuthResponse> {
            return request('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, password}),
            })
        },
        me(): Promise<{ username: string }> {
            return request('/api/auth/me')
        },
    },

    containers: {
        list(): Promise<Container[]> {
            return request('/api/containers')
        },
        get(uuid: string): Promise<any> {
            return request(`/api/containers/${uuid}`)
        },
        stats(uuid: string): Promise<any> {
            return request(`/api/containers/${uuid}/stats`)
        },
        watch(uuid: string): Promise<{ success: boolean }> {
            return request(`/api/containers/${uuid}/watch`, {method: 'POST'})
        },
        unwatch(uuid: string): Promise<{ success: boolean }> {
            return request(`/api/containers/${uuid}/watch`, {method: 'DELETE'})
        },
        instances(uuid: string): Promise<ContainerInstance[]> {
            return request(`/api/containers/${uuid}/instances`)
        },
    },

    logs: {
        query(serviceUuid: string, params?: {
            search?: string
            level?: string
            startTime?: string
            endTime?: string
            instanceId?: string
            field?: string
            fieldValue?: string
            limit?: number
            offset?: number
        }): Promise<LogQueryResult> {
            const qs = new URLSearchParams()
            if (params) {
                for (const [k, v] of Object.entries(params)) {
                    if (v !== undefined && v !== null && v !== '') {
                        qs.set(k, String(v))
                    }
                }
            }
            const query = qs.toString()
            return request(`/api/logs/${serviceUuid}${query ? `?${query}` : ''}`)
        },
        levels(serviceUuid: string): Promise<string[]> {
            return request(`/api/logs/${serviceUuid}/levels`)
        },
        group(serviceUuid: string, field: string, instanceId?: string): Promise<GroupResult> {
            const qs = new URLSearchParams({field})
            if (instanceId) qs.set('instanceId', instanceId)
            return request(`/api/logs/${serviceUuid}/group?${qs}`)
        },
        fieldValues(serviceUuid: string, field: string): Promise<string[]> {
            return request(`/api/logs/${serviceUuid}/field-values?field=${field}`)
        },
    },
}
