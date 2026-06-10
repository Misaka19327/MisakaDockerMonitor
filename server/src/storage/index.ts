import type {ParsedLog} from '../log-parser'
import {nowISO} from '../utils'

export interface Service {
    uuid: string
    serviceKey: string
    project: string | null
    service: string | null
    displayName: string
    createdAt: string
}

export interface LogEntry {
    id?: number
    serviceUuid: string
    containerId: string
    containerName: string
    instanceId: string
    timestamp: string | null
    lineNumber: number
    rawContent: string
    isJson: boolean
    parsedJson: string | null
    level: string | null
    content: string
    hasSql: boolean
    sql: string | null
    createdAt: string
}

export interface ContainerInstance {
    id: string
    serviceUuid: string
    containerId: string
    containerName: string
    startedAt: string
    stoppedAt: string | null
    status: 'running' | 'stopped'
}

export interface LogQueryParams {
    serviceUuid: string
    instanceId?: string
    search?: string
    level?: string
    startTime?: string
    endTime?: string
    field?: string
    fieldValue?: string
    limit?: number
    offset?: number
}

export interface LogQueryResult {
    entries: LogEntry[]
    total: number
    hasMore: boolean
}

export interface GroupResult {
    field: string
    groups: { value: string; count: number }[]
}

export interface StorageAdapter {
    initialize(): Promise<void>
    
    // Services
    getOrCreateService(serviceKey: string, project: string | null, service: string | null, displayName: string): Promise<string>
    
    getServiceByUuid(uuid: string): Promise<Service | null>
    
    getActiveContainerId(serviceUuid: string): Promise<string | null>
    
    // Logs
    insertLogs(entries: LogEntry[]): Promise<void>
    insertLog(entry: LogEntry): Promise<void>
    queryLogs(params: LogQueryParams): Promise<LogQueryResult>
    
    groupByField(serviceUuid: string, field: string, instanceId?: string): Promise<GroupResult>
    
    getDistinctLevels(serviceUuid: string): Promise<string[]>
    
    getDistinctFieldValues(serviceUuid: string, field: string): Promise<string[]>
    deleteLogsByInstance(instanceId: string): Promise<void>
    
    deleteLogsByService(serviceUuid: string): Promise<void>
    deleteLogsBefore(cutoff: string): Promise<number>
    
    // Instances
    createInstance(containerId: string, containerName: string, serviceUuid: string): Promise<string>
    
    stopInstance(instanceId: string): Promise<void>
    
    getInstances(serviceUuid: string): Promise<ContainerInstance[]>
    
    getActiveInstance(serviceUuid: string): Promise<ContainerInstance | null>
    deleteStoppedInstancesWithNoLogs(): Promise<number>
    
    // Watch state
    isContainerWatched(serviceUuid: string): Promise<boolean>
    
    setContainerWatched(serviceUuid: string, watched: boolean): Promise<void>

    checkpoint(): Promise<void>
    vacuum(): Promise<void>
    close(): Promise<void>
}

export function parsedLogToEntry(
    parsed: ParsedLog,
    serviceUuid: string,
    containerId: string,
    containerName: string,
    instanceId: string,
    lineNumber: number
): LogEntry {
    return {
        serviceUuid,
        containerId,
        containerName,
        instanceId,
        timestamp: parsed.timestamp,
        lineNumber,
        rawContent: parsed.raw,
        isJson: parsed.isJson,
        parsedJson: parsed.json ? JSON.stringify(parsed.json) : null,
        level: parsed.level,
        content: parsed.content,
        hasSql: parsed.hasSql,
        sql: parsed.sql,
        createdAt: nowISO(),
    }
}

export function rawLogToEntry(
    rawContent: string,
    serviceUuid: string,
    containerId: string,
    containerName: string,
    instanceId: string,
    lineNumber: number
): LogEntry {
    return {
        serviceUuid,
        containerId,
        containerName,
        instanceId,
        timestamp: null,
        lineNumber,
        rawContent,
        isJson: false,
        parsedJson: null,
        level: null,
        content: rawContent,
        hasSql: false,
        sql: null,
        createdAt: nowISO(),
    }
}

export async function createStorage(type: 'sqlite' | 'clickhouse' | 'mysql'): Promise<StorageAdapter> {
    switch (type) {
        case 'sqlite': {
            const {SqliteStorage} = await import('./sqlite')
            return new SqliteStorage()
        }
        case 'mysql': {
            const {MysqlStorage} = await import('./mysql')
            return new MysqlStorage()
        }
        case 'clickhouse': {
            const {ClickHouseStorage} = await import('./clickhouse')
            return new ClickHouseStorage()
        }
        default:
            throw new Error(`Unknown storage type: ${type}`)
    }
}
