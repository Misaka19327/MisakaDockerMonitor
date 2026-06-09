import {Elysia} from 'elysia'
import {config} from '../config'

export function configRoutes() {
    return new Elysia({prefix: '/api/config'})
        /** 获取服务端配置（时区等） */
        .get('/', () => ({
            timezone: config.timezone,
        }))
}
