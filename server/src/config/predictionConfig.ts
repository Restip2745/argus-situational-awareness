/**
 * Which prediction source is in use.
 *
 * A setting rather than a constant because the answer is regional. Polymarket
 * is DNS-blocked in Taiwan and in other jurisdictions that treat it as
 * gambling; Kalshi resolves there but is thin on live conflict, which is most
 * of what this dashboard watches. Neither is right for everyone, and the choice
 * cannot be made once in a source file for a project that is self-hosted by
 * readers in different places.
 *
 * Kalshi is the default on reachability alone: an empty panel teaches a new
 * reader nothing, and a source that answers is worth more than a source that
 * would be better if it answered.
 */
import { loadPersistedConfig, persistConfig } from './configStore'
import { logger } from '../utils/logger'
import { isProviderName, type ProviderName } from '../services/prediction'

export interface PredictionConfig {
  provider: ProviderName
}

const envProvider = process.env.PREDICTION_PROVIDER
const defaults: PredictionConfig = {
  provider: isProviderName(envProvider) ? envProvider : 'kalshi',
}

const saved: Record<string, unknown> = loadPersistedConfig().prediction ?? {}
// Validated rather than spread in: config.json is editable by hand, and a typo
// there would otherwise reach `providerFor` as an undefined lookup — a crash
// one file away from where the mistake was made.
const config: PredictionConfig = {
  provider: isProviderName(saved.provider) ? saved.provider : defaults.provider,
}

export function getPredictionConfig(): Readonly<PredictionConfig> {
  return { ...config }
}

export function setPredictionConfig(patch: Partial<PredictionConfig>): PredictionConfig {
  if (patch.provider !== undefined && isProviderName(patch.provider)) {
    config.provider = patch.provider
  }
  persistConfig({ prediction: config as unknown as Record<string, unknown> })
  logger.info('[Config]', 'Prediction provider set to:', config.provider)
  return { ...config }
}
