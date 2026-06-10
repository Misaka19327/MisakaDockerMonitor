import {resolve} from 'path'
import {Elysia} from 'elysia'
import {cors} from '@elysiajs/cors'
import {staticPlugin} from '@elysiajs/static'
import {config} from './config'
import {createStorage} from './storage'
import {LogCollector} from './log-collector'
import {cleanupPlugin} from './scheduler'
import {authRoutes} from './routes/auth'
import {configRoutes} from './routes/config'
import {containerRoutes} from './routes/containers'
import {debugRoutes} from './routes/debug'
import {logRoutes} from './routes/logs'
import {toErrorMessage} from './utils'

const CLIENT_DIST = resolve(process.cwd(), '../client/dist')

async function main() {
    console.log(`Starting MisakaDockerMonitor...`)
    console.log(`Storage: ${config.storageType}`)
    console.log(`Timezone: ${config.timezone}`)
    
    // Initialize storage
    const storage = await createStorage(config.storageType)
    await storage.initialize()
    console.log(`Storage initialized`)
    
    // Initialize log collector
    const collector = new LogCollector(storage)
    const deps = {storage, collector}
    
    // Create Elysia app
    const app = new Elysia()
        .use(cors({origin: true, credentials: true}))
        .use(cleanupPlugin(storage))
        .use(configRoutes())
        .use(authRoutes())
        .use(containerRoutes(deps))
        .use(debugRoutes(deps))
        .use(logRoutes(deps))
        .use(await staticPlugin({
            assets: CLIENT_DIST,
            prefix: '',
            indexHTML: true,
            alwaysStatic: process.env.NODE_ENV === 'production',
            silent: true,
        }))
        .onError(({code, error, set, request}) => {
            if (code === 'NOT_FOUND') {
                const url = new URL(request.url)
                if (!url.pathname.startsWith('/api/')) {
                    return Bun.file(`${CLIENT_DIST}/index.html`)
                }
                set.status = 404
                return {error: 'Not Found'}
            }
            const message = toErrorMessage(error)
            console.error(`Error [${code}]:`, message)
            set.status = 500
            return {error: message}
        })
    
    Bun.serve({
        port: config.port,
        hostname: config.host,
        fetch: app.handle,
    })
    
    console.log(`Server running at http://${config.host}:${config.port}`)
    
    // Start log collector
    await collector.start()
    console.log(`Log collector started`)
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('Shutting down...')
        await collector.stop()
        await storage.close()
        process.exit(0)
    })
    
    process.on('SIGTERM', async () => {
        console.log('Shutting down...')
        await collector.stop()
        await storage.close()
        process.exit(0)
    })
}

main().catch(err => {
    console.error('Failed to start:', err)
    process.exit(1)
})
