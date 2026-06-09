import {Elysia, t} from 'elysia'
import {bearer} from '@elysiajs/bearer'
import {signToken, validateCredentials, verifyToken} from '../auth'

export function authRoutes() {
    return new Elysia({prefix: '/api/auth'})
        .post('/login', async ({body, status}) => {
            const {username, password} = body
            
            if (!validateCredentials(username, password)) {
                return status(401, {error: 'Invalid credentials'})
            }
            
            const token = await signToken({sub: username})
            return {token, username}
        }, {
            body: t.Object({
                username: t.String(),
                password: t.String(),
            }),
        })
        .use(bearer())
        .get('/me', async ({bearer, status}) => {
            if (!bearer) return status(401, {error: 'Not authenticated'})
            
            const payload = await verifyToken(bearer)
            if (!payload?.sub) return status(401, {error: 'Not authenticated'})
            
            return {username: payload.sub}
        })
}
