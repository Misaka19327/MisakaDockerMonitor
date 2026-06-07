import { Elysia } from 'elysia'
import { getUserFromRequest } from '../auth'
import { listContainers, getContainer, getContainerStats } from '../docker'
import type { LogCollector } from '../log-collector'
import type { StorageAdapter } from '../storage'

export function containerRoutes(collector: LogCollector, storage: StorageAdapter) {
  return new Elysia({ prefix: '/api/containers' })
    .onBeforeHandle(async ({ request, set }) => {
      const user = await getUserFromRequest(request)
      if (!user) { set.status = 401; return { error: 'Not authenticated' } }
      return undefined // continue
    })
    .get('/', async ({ set }) => {
      try {
        const containers = await listContainers(true)
        return containers.map(c => ({
          id: c.Id,
          name: c.Names?.[0]?.replace(/^\//, '') || '',
          image: c.Image,
          state: c.State,
          status: c.Status,
          created: c.Created,
          ports: c.Ports,
          watched: collector.isWatching(c.Id),
        }))
      } catch (err: any) {
        set.status = 500
        return { error: 'Failed to list containers', details: err.message }
      }
    })
    .get('/:id', async ({ params, set }) => {
      try {
        const info = await getContainer(params.id)
        return {
          id: info.Id,
          name: info.Name?.replace(/^\//, ''),
          image: info.Config?.Image,
          state: info.State?.Status,
          status: info.State?.Running ? 'running' : info.State?.Status,
          created: info.Created,
          ports: info.NetworkSettings?.Ports,
          env: info.Config?.Env,
          watched: collector.isWatching(params.id),
        }
      } catch (err: any) {
        set.status = 404
        return { error: 'Container not found', details: err.message }
      }
    })
    .get('/:id/stats', async ({ params, set }) => {
      try {
        const stats = await getContainerStats(params.id)
        return stats
      } catch (err: any) {
        set.status = 500
        return { error: 'Failed to get stats', details: err.message }
      }
    })
    .post('/:id/watch', async ({ params, set }) => {
      try {
        const info = await getContainer(params.id)
        const name = info.Name?.replace(/^\//, '') || params.id
        await collector.watchContainer(params.id, name)
        return { success: true, message: `Now watching container ${name}` }
      } catch (err: any) {
        set.status = 500
        return { error: 'Failed to watch container', details: err.message }
      }
    })
    .delete('/:id/watch', async ({ params }) => {
      await collector.unwatchContainer(params.id)
      return { success: true, message: 'Stopped watching container' }
    })
    .get('/:id/instances', async ({ params }) => {
      const instances = await storage.getInstances(params.id)
      return instances
    })
}
