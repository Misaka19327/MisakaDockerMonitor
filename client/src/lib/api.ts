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
        get(id: string): Promise<any> {
            return request(`/api/containers/${id}`)
        },
        stats(id: string): Promise<any> {
            return request(`/api/containers/${id}/stats`)
        },
        watch(id: string): Promise<{ success: boolean }> {
            return request(`/api/containers/${id}/watch`, {method: 'POST'})
        },
        unwatch(id: string): Promise<{ success: boolean }> {
            return request(`/api/containers/${id}/watch`, {method: 'DELETE'})
        },
        instances(id: string): Promise<ContainerInstance[]> {
            return request(`/api/containers/${id}/instances`)
        },
    },
    
    logs: {
        query(containerId: string, params?: {
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
            return request(`/api/logs/${containerId}${query ? `?${query}` : ''}`)
        },
        levels(containerId: string): Promise<string[]> {
            return request(`/api/logs/${containerId}/levels`)
        },
        group(containerId: string, field: string, instanceId?: string): Promise<GroupResult> {
            const qs = new URLSearchParams({field})
            if (instanceId) qs.set('instanceId', instanceId)
            return request(`/api/logs/${containerId}/group?${qs}`)
        },
        fieldValues(containerId: string, field: string): Promise<string[]> {
            return request(`/api/logs/${containerId}/field-values?field=${field}`)
        },
    },
}
