/**
 * Dynamic LLM configuration store.
 * Settings are persisted to server/data/config.json on every update and
 * reloaded on startup, so changes survive server restarts.
 */
import { loadPersistedConfig, persistConfig } from './configStore'
import { logger } from '../utils/logger'

export interface LlmConfig {
  host:        string   // Ollama base URL
  model:       string   // Model name, e.g. "gemma4:e4b"
  temperature: number   // 0.0 – 1.0
  contextSize: number   // num_ctx tokens
}

const defaults: LlmConfig = {
  host:        process.env.OLLAMA_HOST  ?? 'http://localhost:11434',
  model:       process.env.OLLAMA_MODEL ?? 'gemma4:e4b',
  temperature: Number(process.env.OLLAMA_TEMPERATURE ?? 0.1),
  // 4096, not 2048: the intensity rubric in SYSTEM_PROMPT pushed the prompt past
  // what 2048 could hold, and the overflow truncated the JSON mid-string rather
  // than failing loudly — four articles in ninety-four silently lost.
  contextSize: Number(process.env.OLLAMA_CTX         ?? 4096),
}

// Merge persisted values over env-var defaults on startup
const saved = loadPersistedConfig().llm ?? {}
const config: LlmConfig = { ...defaults, ...saved } as LlmConfig

export function getLlmConfig(): Readonly<LlmConfig> {
  return { ...config }
}

export function setLlmConfig(patch: Partial<LlmConfig>): LlmConfig {
  if (patch.host        !== undefined) config.host        = patch.host
  if (patch.model       !== undefined) config.model       = patch.model
  if (patch.temperature !== undefined) config.temperature = Math.max(0, Math.min(1, patch.temperature))
  if (patch.contextSize !== undefined) config.contextSize = Math.max(512, Math.min(32768, patch.contextSize))
  persistConfig({ llm: config as unknown as Record<string, unknown> })
  logger.info('[Config]', 'LLM config updated:', config)
  return { ...config }
}
