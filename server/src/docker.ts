import type {ContainerStats} from 'dockerode'
import Docker from 'dockerode'
import {PassThrough, Readable} from 'stream'
import {config} from './config'

let docker: Docker

export function getDocker(): Docker {
  if (!docker) {
    docker = new Docker({socketPath: config.docker.socketPath})
  }
  return docker
}

export async function listContainers(all = false) {
  const d = getDocker()
  return d.listContainers({all}) as Promise<any[]>
}

export async function getContainer(id: string) {
  const d = getDocker()
  const container = d.getContainer(id)
  return await container.inspect()
}

export async function getContainerStats(id: string) {
  const d = getDocker()
  const container = d.getContainer(id)
  return new Promise<ContainerStats>((resolve, reject) => {
    container.stats({stream: false}, (err, stats) => {
      if (err) reject(err)
      else if (stats) resolve(stats)
      else reject(new Error('No stats returned'))
    })
  })
}

export interface LogStreamOptions {
  containerId: string
  since?: number
  follow?: boolean
  tail?: number
  onLog: (line: string) => void
  onError?: (err: Error) => void
  onEnd?: () => void
}

export async function streamContainerLogs(opts: LogStreamOptions) {
  const d = getDocker()
  const container = d.getContainer(opts.containerId)
  
  const streamOpts: Docker.ContainerLogsOptions = {
    stdout: true,
    stderr: true,
    timestamps: false,
    tail: opts.tail ?? 0,
  }
  
  if (opts.since) {
    streamOpts.since = opts.since
  }
  
  const stream: Readable =
      opts.follow === false
          ? Readable.from([await container.logs({...streamOpts, follow: false})])
          : await container.logs({...streamOpts, follow: true}) as unknown as Readable
  
  // Use dockerode's built-in demuxStream to properly separate headers
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  
  // Demux the Docker stream (strips 8-byte headers)
  container.modem.demuxStream(stream, stdout, stderr)
  
  let stdoutBuffer = ''
  let stderrBuffer = ''
  
  const handleData = (chunk: Buffer, buffer: string) => {
    const text = chunk.toString('utf-8')
    const lines = `${buffer}${text}`.split('\n')
    const remainder = lines.pop() ?? ''
    
    for (const line of lines) {
      const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
      if (normalized.length > 0) {
        opts.onLog(normalized)
      }
    }
    
    return remainder
  }
  
  const flushBuffer = (buffer: string) => {
    const normalized = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
    if (normalized.length > 0) {
      opts.onLog(normalized)
    }
  }
  
  stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer = handleData(chunk, stdoutBuffer)
  })
  stderr.on('data', (chunk: Buffer) => {
    stderrBuffer = handleData(chunk, stderrBuffer)
  })
  
  stream.on('error', (err: Error) => {
    opts.onError?.(err)
  })
  
  stream.on('end', () => {
    flushBuffer(stdoutBuffer)
    flushBuffer(stderrBuffer)
    opts.onEnd?.()
  })
  
  return stream
}

export async function watchContainerEvents(onEvent: (event: {
  type: string;
  containerId: string;
  containerName: string
}) => void) {
  const d = getDocker()
  
  const stream = await d.getEvents({filters: {event: ['start', 'die', 'restart']}}) as unknown as Readable
  let buffer = ''
  
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    
    for (const line of lines) {
      if (!line.trim()) continue
      
      try {
        const evt = JSON.parse(line)
        const containerId = evt.Actor?.ID
        const containerName = evt.Actor?.Attributes?.name || ''
        if (containerId) {
          onEvent({
            type: evt.status || evt.Action || '',
            containerId,
            containerName,
          })
        }
      } catch {
        // ignore parse errors
      }
    }
  })
  
  return stream
}
