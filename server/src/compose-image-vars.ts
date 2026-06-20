import {isMap, parseDocument, Scalar} from 'yaml'

export function getServiceImageTemplate(composeContent: string, serviceName: string): string | null {
    const document = parseDocument(composeContent)
    if (document.errors.length > 0) {
        throw new Error(`Failed to parse compose file: ${document.errors[0].message}`)
    }

    const root = document.contents
    if (!isMap(root)) return null

    const servicesNode = root.get('services', true)
    if (!isMap(servicesNode)) return null

    const serviceNode = servicesNode.get(serviceName, true)
    if (!isMap(serviceNode)) return null

    const imageNode = serviceNode.get('image', true)
    if (!imageNode) return null
    return String(imageNode instanceof Scalar ? imageNode.value : imageNode)
}

export function inferComposeImageVariables(imageTemplate: string | null, currentImage: string | null): Record<string, string> {
    if (!imageTemplate || !currentImage) return {}

    const variables = getComposeImageVariableNames(imageTemplate)
    if (variables.length === 0) return {}

    const match = new RegExp(`^${templateToRegex(imageTemplate)}$`).exec(currentImage)
    if (!match?.groups) return {}

    const env: Record<string, string> = {}
    for (const variable of variables) {
        const value = match.groups[variable]
        if (value !== undefined) env[variable] = value
    }
    return env
}

export function getComposeImageVariableNames(imageTemplate: string | null): string[] {
    return imageTemplate ? uniqueVariables(parseTemplateReferences(imageTemplate).map(reference => reference.name)) : []
}

export function getRequiredComposeImageVariableNames(imageTemplate: string | null): string[] {
    return imageTemplate
        ? uniqueVariables(parseTemplateReferences(imageTemplate)
            .filter(reference => reference.required)
            .map(reference => reference.name))
        : []
}

interface TemplateReference {
    name: string
    required: boolean
}

function parseTemplateReferences(template: string): TemplateReference[] {
    const references: TemplateReference[] = []
    for (const match of template.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])[^}]*)?\}/g)) {
        const operator = match[2] ?? ''
        references.push({
            name: match[1],
            required: operator === '' || operator.includes('?'),
        })
    }
    return references
}

function uniqueVariables(variables: string[]): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    for (const variable of variables) {
        if (seen.has(variable)) continue
        seen.add(variable)
        result.push(variable)
    }
    return result
}

function templateToRegex(template: string): string {
    let regex = ''
    let cursor = 0
    const emittedVariables = new Set<string>()
    for (const match of template.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])[^}]*)?\}/g)) {
        const variable = match[1]
        regex += escapeRegex(template.slice(cursor, match.index))
        regex += emittedVariables.has(variable) ? `\\k<${variable}>` : `(?<${variable}>.+?)`
        emittedVariables.add(variable)
        cursor = match.index + match[0].length
    }
    regex += escapeRegex(template.slice(cursor))
    return regex
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
