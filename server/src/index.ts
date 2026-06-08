import { resolve } from 'path'
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { config } from './config'
import { createStorage } from './storage'
import { LogCollector } from './log-collector'
import { startCleanupScheduler } from './scheduler'
import { authRoutes } from './routes/auth'
import { configRoutes } from './routes/config'
import { containerRoutes } from './routes/containers'
import { logRoutes } from './routes/logs'
import { toErrorMessage } from './utils'
import { getContainer } from './docker'

const CLIENT_DIST = resolve(process.cwd(), '../client/dist')

async function main() {
  console.log(`Starting MisakaDockerMonitor...`)
  console.log(`Storage: ${config.storageType}`)
  console.log(`Timezone: ${config.timezone}`)

  // Initialize storage
  const storage = await createStorage(config.storageType)
  await storage.initialize()
  console.log(`Storage initialized`)

  // Start cleanup scheduler
  const stopCleanup = startCleanupScheduler(storage)

  // Initialize log collector
  const collector = new LogCollector(storage)

  // Create Elysia app (API only)
  const app = new Elysia()
    .use(cors({ origin: true, credentials: true }))
    .use(configRoutes())
    .use(authRoutes())
    .use(containerRoutes(collector, storage))
    .use(logRoutes(storage, { getContainer }))
    .onError(({ code, error, set }) => {
      const message = toErrorMessage(error)
      console.error(`Error [${code}]:`, message)
      set.status = code === 'NOT_FOUND' ? 404 : 500
      return { error: message }
    })

  // Use Bun.serve directly with custom fetch for static + API
  Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: async (req) => {
      const url = new URL(req.url)
      const pathname = url.pathname

      // API routes → delegate to Elysia
      if (pathname.startsWith('/api/')) {
        return app.handle(req)
      }

      // Static files: try exact path first
      const staticPath = pathname === '/' ? '/index.html' : pathname
      const file = Bun.file(`${CLIENT_DIST}${staticPath}`)
      if (await file.exists()) {
        return new Response(file)
      }

      // SPA fallback: return index.html for all non-file routes
      const indexFile = Bun.file(`${CLIENT_DIST}/index.html`)
      return new Response(indexFile)
    },
  })

  console.log(`Server running at http://${config.host}:${config.port}`)

  // Start log collector
  await collector.start()
  console.log(`Log collector started`)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...')
    stopCleanup()
    await collector.stop()
    await storage.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('Shutting down...')
    stopCleanup()
    await collector.stop()
    await storage.close()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('Failed to start:', err)
  process.exit(1)
})
