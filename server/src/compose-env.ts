import {dirname} from 'path'
import {parseDocument, isMap, isSeq, Scalar, YAMLMap} from 'yaml'
import {readFile, writeFile} from 'fs/promises'

export type EnvOperation =
    | { type: 'set'; key: string; value: string }
    | { type: 'rename'; originalKey: string; key: string; value: string }
    | { type: 'delete'; key: string }

export interface ComposeEnvCommitResult {
    projectDirectory: string
    env: string[]
    originalContent: string
}

interface EnvironmentEntry {
    key: string
    value: string
}

export async function applyComposeEnvOperations(
    composePath: string,
    serviceName: string,
    operations: EnvOperation[],
): Promise<ComposeEnvCommitResult> {
    if (operations.length === 0) {
        throw new Error('No environment changes to submit')
    }

    const content = await readFile(composePath, 'utf8')
    const document = parseDocument(content)
    if (document.errors.length > 0) {
        throw new Error(`Failed to parse compose file: ${document.errors[0].message}`)
    }

    const root = document.contents
    if (!isMap(root)) {
        throw new Error('Compose file root must be a map')
    }

    const servicesNode = root.get('services', true)
    if (!isMap(servicesNode)) {
        throw new Error('Compose file must contain a services map')
    }

    const serviceNode = servicesNode.get(serviceName, true)
    if (!isMap(serviceNode)) {
        throw new Error(`Compose service "${serviceName}" was not found`)
    }

    const envEntries = readEnvironmentEntries(serviceNode)
    assertUniqueKeys(envEntries.map(entry => entry.key))
    assertOperationsKeepUniqueKeys(envEntries.map(entry => entry.key), operations)

    const env = new Map(envEntries.map(entry => [entry.key, entry.value]))
    for (const operation of operations) {
        applyOperation(env, operation)
    }

    const environmentNode = new YAMLMap()
    for (const [key, value] of env.entries()) {
        environmentNode.set(key, value)
    }
    serviceNode.set('environment', environmentNode)

    await writeFile(composePath, document.toString(), 'utf8')

    return {
        projectDirectory: dirname(composePath),
        env: Array.from(env.entries()).map(([key, value]) => `${key}=${value}`),
        originalContent: content,
    }
}

function readEnvironmentEntries(serviceNode: YAMLMap): EnvironmentEntry[] {
    const env: EnvironmentEntry[] = []
    const environmentNode = serviceNode.get('environment', true)
    if (!environmentNode) {
        return env
    }

    if (isMap(environmentNode)) {
        for (const pair of environmentNode.items) {
            const key = String(pair.key instanceof Scalar ? pair.key.value : pair.key)
            const rawValue = pair.value instanceof Scalar ? pair.value.value : pair.value
            env.push({key, value: rawValue == null ? '' : String(rawValue)})
        }
        return env
    }

    if (isSeq(environmentNode)) {
        for (const item of environmentNode.items) {
            const raw = item instanceof Scalar ? item.value : item
            if (raw == null) continue
            const line = String(raw)
            const eqIndex = line.indexOf('=')
            if (eqIndex < 0) {
                env.push({key: line, value: ''})
            } else {
                env.push({key: line.slice(0, eqIndex), value: line.slice(eqIndex + 1)})
            }
        }
        return env
    }

    throw new Error('Compose service environment must be a map or list')
}

function assertOperationsKeepUniqueKeys(initialKeys: string[], operations: EnvOperation[]): void {
    const keys = [...initialKeys]
    for (const operation of operations) {
        switch (operation.type) {
            case 'set': {
                const key = normalizeKey(operation.key)
                if (!keys.includes(key)) keys.push(key)
                break
            }
            case 'rename': {
                const originalKey = normalizeKey(operation.originalKey)
                const key = normalizeKey(operation.key)
                const index = keys.indexOf(originalKey)
                if (index >= 0) keys[index] = key
                else keys.push(key)
                break
            }
            case 'delete': {
                const key = normalizeKey(operation.key)
                const index = keys.indexOf(key)
                if (index >= 0) keys.splice(index, 1)
                break
            }
        }
        assertUniqueKeys(keys)
    }
}

function assertUniqueKeys(keys: string[]): void {
    const seen = new Set<string>()
    for (const key of keys) {
        if (seen.has(key)) {
            throw new Error(`Duplicate environment variable key: ${key}`)
        }
        seen.add(key)
    }
}

function applyOperation(env: Map<string, string>, operation: EnvOperation): void {
    switch (operation.type) {
        case 'set': {
            const key = normalizeKey(operation.key)
            env.set(key, operation.value)
            return
        }
        case 'rename': {
            const originalKey = normalizeKey(operation.originalKey)
            const key = normalizeKey(operation.key)
            if (originalKey !== key) {
                env.delete(originalKey)
            }
            env.set(key, operation.value)
            return
        }
        case 'delete': {
            env.delete(normalizeKey(operation.key))
            return
        }
    }
}

function normalizeKey(key: string): string {
    const trimmed = key.trim()
    if (!trimmed) {
        throw new Error('Environment variable key is required')
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
        throw new Error(`Invalid environment variable key: ${trimmed}`)
    }
    return trimmed
}
