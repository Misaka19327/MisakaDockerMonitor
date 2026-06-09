export interface ContainerStats {
  cpuPercent: number | null
  memUsage: string | null
  memPercent: number | null
  diskRead: string | null
  diskWrite: string | null
  uptime: string | null
}

export interface Container {
  id: string
  name: string
  image: string
  state: string
  status: string
  created: number
  ports: { IP?: string; PrivatePort?: number; PublicPort?: number; Type?: string }[]
  watched: boolean
  stats: ContainerStats | null
  health?: string | null
  exitCode?: number | null
  pid?: number | null
  restartCount?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  uptime?: string | null
  networks?: string[]
  restartPolicy?: string | null
    env?: string[] | null
}

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

export interface LogQueryResult {
  entries: LogEntry[]
  total: number
  hasMore: boolean
  container: Container | null
}

export interface GroupResult {
  field: string
  groups: { value: string; count: number }[]
}

export interface AppConfig {
  timezone: string
}

export interface AuthResponse {
  token: string
  username: string
}
