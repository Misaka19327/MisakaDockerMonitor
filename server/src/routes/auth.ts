import { Elysia, t } from 'elysia'
import { validateCredentials, signToken } from '../auth'

export function authRoutes() {
  return new Elysia({ prefix: '/api/auth' })
    .post('/login', async ({ body, set }) => {
      const { username, password } = body as { username: string; password: string }

      if (!validateCredentials(username, password)) {
        set.status = 401
        return { error: 'Invalid credentials' }
      }

      const token = await signToken({ sub: username })
      return { token, username }
    }, {
      body: t.Object({
        username: t.String(),
        password: t.String(),
      }),
    })
    .get('/me', async ({ request, set }) => {
      const auth = request.headers.get('authorization')
      if (!auth) { set.status = 401; return { error: 'Not authenticated' } }

      // Dynamic import to avoid circular dep
      const { verifyToken } = await import('../auth')
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
      const payload = await verifyToken(token)
      if (!payload?.sub) { set.status = 401; return { error: 'Not authenticated' } }

      return { username: payload.sub }
    })
}
