import { SignJWT, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'
import { config } from './config'

const JWT_SECRET = new TextEncoder().encode(config.auth.jwtSecret)

export async function signToken(payload: { sub: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + config.auth.tokenTtlSeconds,
    )
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ['HS256'],
    })
    return payload
  } catch {
    return null
  }
}

export function validateCredentials(username: string, password: string): boolean {
  return username === config.auth.username && password === config.auth.password
}

/** Extract user from Authorization header, return null if not authenticated */
export async function getUserFromRequest(request: Request): Promise<{ username: string } | null> {
  const auth =
    request.headers.get('authorization') ||
    request.headers.get('Authorization') ||
    null

  if (!auth) return null

  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  const payload = await verifyToken(token)
  if (!payload || !payload.sub) return null

  return { username: payload.sub as string }
}
