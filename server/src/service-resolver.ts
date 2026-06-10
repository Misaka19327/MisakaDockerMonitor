import type {StorageAdapter} from './storage'
import {getContainer} from './docker'

export class ServiceResolver {
    constructor(private storage: StorageAdapter) {
    }
    
    extractIdentity(labels: Record<string, string>, containerName: string): {
        serviceKey: string
        project: string | null
        service: string | null
        displayName: string
    } {
        const project = labels['com.docker.compose.project'] ?? null
        const service = labels['com.docker.compose.service'] ?? null
        
        if (project && service) {
            return {
                serviceKey: `${project}_${service}`,
                project,
                service,
                displayName: service,
            }
        }
        
        const name = containerName.replace(/^\//, '')
        return {
            serviceKey: name,
            project: null,
            service: null,
            displayName: name,
        }
    }
    
    async resolve(labels: Record<string, string>, containerName: string): Promise<string> {
        const {serviceKey, project, service, displayName} = this.extractIdentity(labels, containerName)
        return this.storage.getOrCreateService(serviceKey, project, service, displayName)
    }
    
    async resolveFromContainerId(containerId: string): Promise<string> {
        const info = await getContainer(containerId)
        const name = info.Name?.replace(/^\//, '') || containerId
        const labels = info.Config?.Labels || {}
        return this.resolve(labels, name)
    }
}
