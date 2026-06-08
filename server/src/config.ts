import { randomBytes } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const generatedJwtSecret = randomBytes(32).toString('hex')
const authUsername = process.env.AUTH_USERNAME || 'admin'
const authPassword = process.env.AUTH_PASSWORD || 'change-me'
const defaultTimeZone = 'Asia/Shanghai'

function resolveTimeZone(value: string | undefined): string {
  const candidate = value || defaultTimeZone

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date())
    return candidate
  } catch {
    console.warn(`Invalid timezone "${candidate}", falling back to ${defaultTimeZone}`)
    return defaultTimeZone
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  timezone: resolveTimeZone(process.env.TIMEZONE || process.env.TZ),

  storageType: (process.env.STORAGE_TYPE || 'sqlite') as 'sqlite' | 'clickhouse' | 'mysql',

  sqlite: {
    path: process.env.SQLITE_PATH || './data/logs.db',
    journalMode: (process.env.SQLITE_JOURNAL_MODE || 'WAL').toUpperCase(),
    synchronous: (process.env.SQLITE_SYNCHRONOUS || 'NORMAL').toUpperCase(),
  },

  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'docker_monitor',
  },

  clickhouse: {
    host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    database: process.env.CLICKHOUSE_DATABASE || 'docker_monitor',
    user: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  },

  docker: {
    socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  },

  auth: {
    username: authUsername,
    password: authPassword,
    jwtSecret: process.env.JWT_SECRET || generatedJwtSecret,
    tokenTtlSeconds: parseInt(process.env.JWT_TTL_SECONDS || '86400'),
  },

  retainLogsOnRestart: process.env.RETAIN_LOGS_ON_RESTART !== 'false',
}

export function ensureDataDir() {
  const dir = dirname(config.sqlite.path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
