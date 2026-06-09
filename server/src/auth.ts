import type {JWTPayload} from 'jose'
import {jwtVerify, SignJWT} from 'jose'
import {config} from './config'

const JWT_SECRET = new TextEncoder().encode(config.auth.jwtSecret)

export async function signToken(payload: { sub: string }): Promise<string> {
  return new SignJWT(payload)
      .setProtectedHeader({alg: 'HS256'})
      .setIssuedAt()
      .setExpirationTime(
          Math.floor(Date.now() / 1000) + config.auth.tokenTtlSeconds,
      )
      .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const {payload} = await jwtVerify(token, JWT_SECRET, {
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

/** Extract user from Authorization header or query param token, return null if not authenticated */
export async function getUserFromRequest(request: Request): Promise<{ username: string } | null> {
  let token: string | null = null
  
  const auth =
      request.headers.get('authorization') ||
      request.headers.get('Authorization') ||
      null
  
  if (auth) {
    token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  }
  
  if (!token) {
    const url = new URL(request.url)
    token = url.searchParams.get('token')
  }
  
  if (!token) return null
  
  const payload = await verifyToken(token)
  if (!payload || !payload.sub) return null
  
  return {username: payload.sub as string}
}
