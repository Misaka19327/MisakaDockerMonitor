import { Elysia } from 'elysia'
import { config } from '../config'

export function configRoutes() {
  return new Elysia({ prefix: '/api/config' })
    .get('/', () => ({
      timezone: config.timezone,
    }))
}
