import { Elysia } from 'elysia'
import { bearer } from '@elysiajs/bearer'
import { verifyToken } from '../auth'

export const authGuard = new Elysia({ name: 'auth-guard' })
  .use(bearer())
  .resolve(async ({ bearer, query, status }) => {
    const token = bearer || (query as Record<string, unknown>).token as string | undefined
    if (!token) return status(401, { error: 'Not authenticated' })

    const payload = await verifyToken(token)
    if (!payload?.sub) return status(401, { error: 'Not authenticated' })

    return { user: { username: payload.sub as string } }
  })
