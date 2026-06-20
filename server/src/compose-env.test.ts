import {mkdtemp, readFile, rm, writeFile} from 'fs/promises'
import {join} from 'path'
import {tmpdir} from 'os'
import {expect, test} from 'bun:test'
import {applyComposeEnvOperations} from './compose-env'

test('returns the original compose content before applying env operations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mdm-compose-env-'))
    const composePath = join(dir, 'docker-compose.yml')
    const originalContent = `version: "3.5"
services:
  app:
    image: example/app:\${VERSION}
    environment:
      APP_ENV: dev
`

    try {
        await writeFile(composePath, originalContent, 'utf8')

        const result = await applyComposeEnvOperations(composePath, 'app', [
            {type: 'set', key: 'APP_ENV', value: 'test'},
        ])

        expect(result.originalContent).toBe(originalContent)
        expect(await readFile(composePath, 'utf8')).toContain('APP_ENV: test')

        await writeFile(composePath, result.originalContent, 'utf8')
        expect(await readFile(composePath, 'utf8')).toBe(originalContent)
    } finally {
        await rm(dir, {recursive: true, force: true})
    }
})
