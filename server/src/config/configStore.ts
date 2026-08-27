/**
 * Atomic JSON config persistence.
 * Writes to a .tmp file then renames to avoid partial-write corruption.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { logger } from '../utils/logger'

const CONFIG_PATH = join(__dirname, '../../../data/config.json')

interface PersistedConfig {
  llm?: Record<string, unknown>
  feeds?: unknown[]
  ui?: Record<string, unknown>
  prediction?: Record<string, unknown>
}

function ensureDir(): void {
  const dir = dirname(CONFIG_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadPersistedConfig(): PersistedConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {}
    const raw = readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(raw) as PersistedConfig
  } catch {
    return {}
  }
}

export function persistConfig(patch: Partial<PersistedConfig>): void {
  try {
    ensureDir()
    const current = loadPersistedConfig()
    const next: PersistedConfig = { ...current, ...patch }
    const tmp = CONFIG_PATH + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, CONFIG_PATH)
  } catch (err) {
    logger.warn('[Config]', 'Failed to persist config:', (err as Error).message)
  }
}
