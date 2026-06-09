import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { config } from './config'
import { ensureDataDir } from './config'

export class WatchState {
  private filePath: string
  private state: Record<string, boolean> = {}

  constructor() {
    ensureDataDir()
    this.filePath = resolve(dirname(config.sqlite.path), 'watch_state.json')
    this.load()
  }

  private load() {
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      this.state = JSON.parse(raw)
    } catch {
      this.state = {}
    }
  }

  private save() {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8')
  }

  isWatched(containerId: string): boolean {
    if (!(containerId in this.state)) return true
    return this.state[containerId]
  }

  setWatched(containerId: string, watched: boolean) {
    if (watched) {
      delete this.state[containerId]
    } else {
      this.state[containerId] = false
    }
    this.save()
  }
}
