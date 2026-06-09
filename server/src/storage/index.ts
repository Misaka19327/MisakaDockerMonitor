import type { ParsedLog } from '../log-parser'
import { nowISO } from '../utils'

export interface LogEntry {
  id?: number
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
  containerId: string
  containerName: string
  startedAt: string
  stoppedAt: string | null
  status: 'running' | 'stopped'
}

export interface LogQueryParams {
  containerId: string
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
  insertLogs(entries: LogEntry[]): Promise<void>
  insertLog(entry: LogEntry): Promise<void>
  queryLogs(params: LogQueryParams): Promise<LogQueryResult>
  groupByField(containerId: string, field: string, instanceId?: string): Promise<GroupResult>
  createInstance(containerId: string, containerName: string): Promise<string>
  stopInstance(instanceId: string): Promise<void>
  getInstances(containerId: string): Promise<ContainerInstance[]>
  getActiveInstance(containerId: string): Promise<ContainerInstance | null>
  isContainerWatched(containerId: string): Promise<boolean>
  setContainerWatched(containerId: string, watched: boolean): Promise<void>
  getDistinctLevels(containerId: string): Promise<string[]>
  getDistinctFieldValues(containerId: string, field: string): Promise<string[]>
  deleteLogsByInstance(instanceId: string): Promise<void>
  deleteLogsByContainer(containerId: string): Promise<void>
  deleteLogsBefore(cutoff: string): Promise<number>
  deleteStoppedInstancesWithNoLogs(): Promise<number>
  checkpoint(): Promise<void>
  vacuum(): Promise<void>
  close(): Promise<void>
}

export function parsedLogToEntry(
  parsed: ParsedLog,
  containerId: string,
  containerName: string,
  instanceId: string,
  lineNumber: number
): LogEntry {
  return {
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

export async function createStorage(type: 'sqlite' | 'clickhouse' | 'mysql'): Promise<StorageAdapter> {
  switch (type) {
    case 'sqlite': {
      const { SqliteStorage } = await import('./sqlite')
      return new SqliteStorage()
    }
    case 'mysql': {
      const { MysqlStorage } = await import('./mysql')
      return new MysqlStorage()
    }
    case 'clickhouse': {
      const { ClickHouseStorage } = await import('./clickhouse')
      return new ClickHouseStorage()
    }
    default:
      throw new Error(`Unknown storage type: ${type}`)
  }
}
