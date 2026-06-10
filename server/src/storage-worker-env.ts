export interface StorageWorkerEnv {
    STORAGE_TYPE: string
    SQLITE_PATH: string
    SQLITE_JOURNAL_MODE: string
    SQLITE_SYNCHRONOUS: string
    MYSQL_HOST: string
    MYSQL_PORT: string
    MYSQL_USER: string
    MYSQL_PASSWORD: string
    MYSQL_DATABASE: string
    CLICKHOUSE_HOST: string
    CLICKHOUSE_DATABASE: string
    CLICKHOUSE_USER: string
    CLICKHOUSE_PASSWORD: string
    TIMEZONE: string
    TZ: string
}

export function applyStorageWorkerEnv(env: StorageWorkerEnv) {
    for (const [key, value] of Object.entries(env)) {
        process.env[key] = value
    }
}
