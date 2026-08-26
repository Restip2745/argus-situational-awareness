import { Ollama } from 'ollama'
import cron from 'node-cron'
import type { Server } from 'socket.io'
import type {
  Article, OllamaClassification, EventCategory, EventIntensity, SourceReliability,
  MarketCommodity, MarketLink,
} from '../types'
import { VALID_CATEGORIES, VALID_INTENSITIES, VALID_MARKET_COMMODITIES } from '../types'
import { logger } from '../utils/logger'

const VALID_RELIABILITIES: SourceReliability[] = ['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']
import {
  getPendingArticles,
  markAnalyzed,
  markAnalysisFailed,
  resetFailedArticles,
  getArticleById,
  articleToClientEvent,
} from '../db/sqlite'
import { broadcastEvent } from './socket'
import { resolveLocation } from '../data/gazetteer'
import { getLlmConfig } from '../config/llmConfig'

// Ollama client is recreated per-call so host changes take effect immediately
function getClient(): Ollama {
  return new Ollama({ host: getLlmConfig().host })
}

// ── System prompt (from README spec) ────────────────────

export const SYSTEM_PROMPT = `You are an intelligence analysis system. Your task is to classify a news article and extract structured geopolitical or astronomical data from it.

You MUST respond with a single valid JSON object only. No explanation, no markdown, no extra text — only raw JSON.

Follow this schema exactly:
{
  "category": string,         // One of: ARMED_CONFLICT | POLITICAL | ECONOMIC | SOCIAL | SCIENCE_TECH | ENVIRONMENT | HEALTH | CRIME_SECURITY | SPACE
                              // ARMED_CONFLICT is fighting itself — strikes, attacks, casualties.
                              // Military policy, appointments, procurement and capability analysis are POLITICAL.
  "intensity": string,        // One of: LOW | MODERATE | HIGH | CRITICAL
                              // Judge what has already happened, not what it might lead to.
                              // CRITICAL: already at the top of its scale — 10+ killed in one
                              //   incident, direct military exchange between states, a nuclear
                              //   or chemical release, a government or capital falling, or a
                              //   population-wide collapse of food, water, power or medical care.
                              // HIGH: deaths or injuries below that scale, an armed attack, a
                              //   declared national emergency, or a head of state or government
                              //   personally at risk.
                              // MODERATE: no casualties, but disruption already reaching a
                              //   country's people, economy, or infrastructure.
                              // LOW: announcements, statements, proposals, routine politics,
                              //   sport, and anything whose effect has not yet been realised.
  "title_zh": string,         // Traditional Chinese (zh-TW) translation of the title, max 40 characters. Use Taiwanese conventions, not Simplified.
  "summary_en": string,       // One-sentence English summary of what happened, max 200 characters
  "summary_zh": string,       // The same summary in Traditional Chinese (zh-TW), max 120 characters
  "location": {
    "type": string,           // "geo" for Earth surface events | "orbital" for space events
    "label": string,          // Human-readable location name, e.g. "Ukraine" or "Inner Solar System"
    "lat": number | null,     // Latitude (-90 to 90), null if type is "orbital"
    "lng": number | null,     // Longitude (-180 to 180), null if type is "orbital"
    "body": string | null     // Celestial body name if type is "orbital", e.g. "3I/ATLAS", "Mars", null if type is "geo"
  },
  "actors": string[],         // Key parties involved, e.g. ["Ukraine", "Russia"] or ["NASA", "ESA"]
  "sources_count": number,    // Number of corroborating sources mentioned in the article (estimate 1 if unknown)
  "tags": string[],           // 2–4 short keyword tags in English, e.g. ["military", "frontline", "artillery"]
  "reliability": string,      // Perceived source reliability: HIGH | MEDIUM | LOW | UNVERIFIED
  "market_link": string[]     // 0-2 of: CRUDE_OIL | NATURAL_GAS | GOLD | SILVER | COPPER | WHEAT.
                              // Empty unless the commodity's own supply or price is the story, or a
                              // named facility or route carrying it was damaged or blocked.
                              // Market wraps and economic commentary are empty.
}`

// ── Heat score calculation ──────────────────────────────

export function calculateHeatScore(data: OllamaClassification): number {
  let score = 0

  // Intensity base
  switch (data.intensity) {
    case 'CRITICAL':  score += 1.0; break
    case 'HIGH':      score += 0.6; break
    case 'MODERATE':  score += 0.3; break
    // LOW: +0.0
  }

  // Sources count: +0.1 each, max +0.5
  score += Math.min((data.sources_count ?? 1) * 0.1, 0.5)

  // Category bonus
  if (data.category === 'ARMED_CONFLICT' || data.category === 'SPACE') {
    score += 0.2
  } else if (data.category === 'POLITICAL' || data.category === 'ECONOMIC') {
    score += 0.1
  }

  return Math.round(score * 100) / 100
}

export function calculateExpiresAt(heatScore: number): string {
  const now = Date.now()
  let ms: number
  if (heatScore >= 1.5)      ms = 7 * 24 * 3600_000      // 7 days
  else if (heatScore >= 1.0) ms = 3 * 24 * 3600_000      // 3 days
  else if (heatScore >= 0.5) ms = 48 * 3600_000           // 48 hours
  else                       ms = 24 * 3600_000           // 24 hours
  // Use SQLite-compatible format (space separator, no trailing Z)
  // so datetime comparisons with datetime('now') work correctly
  return new Date(now + ms).toISOString().replace('T', ' ').replace('Z', '')
}

// ── Ollama call + validation ────────────────────────────

async function callOllama(title: string, content: string | null): Promise<OllamaClassification> {
  const userPrompt = `Classify the following news article:\n\nTitle: ${title}\n\nContent: ${(content ?? '').slice(0, 800)}\n\nRespond with JSON only.`

  const cfg = getLlmConfig()
  const response = await getClient().chat({
    model: cfg.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userPrompt },
    ],
    format: 'json',
    options: { temperature: cfg.temperature, num_ctx: cfg.contextSize },
  })

  const parsed = JSON.parse(response.message.content)
  return validateClassification(parsed)
}

/**
 * Free text from the model, clamped and sanity-checked.
 *
 * The model now does three jobs in one call (classify, translate, summarise),
 * and the translation half is the fragile one — a small model will sometimes
 * echo the prompt, answer in the wrong language, or run past the length limit.
 * None of that may be allowed to cost us the classification, so every text
 * field degrades to '' and the caller falls back to the original title.
 */
function cleanText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return ''
  const s = raw.replace(/\s+/g, ' ').trim()
  if (!s || s.length > maxLen * 2) return ''   // absurdly long → model rambled
  return s.length > maxLen ? s.slice(0, maxLen) : s
}

/** True if the string carries any Han characters — used to catch the model
 *  returning English where Chinese was asked for, which would silently give
 *  both languages the same text. */
function hasHan(s: string): boolean {
  return /[一-鿿㐀-䶿]/.test(s)
}

/**
 * Simplified forms that have no business in a zh-TW string.
 *
 * The prompt asks for Taiwanese conventions and the models largely comply, but
 * both leak the occasional Simplified character mid-sentence — roughly two
 * articles in a hundred, never enough to stop the text looking like Chinese.
 * `hasHan` cannot see it, so until now the leak reached the database and the
 * globe unremarked, and a reader saw 简体 in a panel that promises 繁體.
 *
 * Only forms with no Traditional reading are listed. Characters that exist in
 * both scripts carrying different meanings — 后 后/後, 干 干/幹/乾, 里 里/裡,
 * 面 面/麵, 丰 丰/豐 — are deliberately absent: catching those would throw away
 * correct Traditional text, which costs more than the leak does.
 */
const SIMPLIFIED_ONLY =
  '这说时国请对应关长门问间实现发经济产业务网络题级际认识语话读写译华报响声动' +
  '员数术军战边过还运达进农设备计让传张润无开击论议会学医儿东车马鸟龙飞风汉' +
  '权义亚岁万与专严们个剧场价压极见观觉讲该变单双组织结给续统纪约线维紧纳纸' +
  '细终绝绕绍缘缩选适遗递迟连远迈违铁银钱钟锁错镇铜针钢韩顾领项顺预类频陆队' +
  '阶险阳阴陈乐药苏荣营节兰习书买卖贵费资质赛贸财责购贫赔虽显晓归岛属层尽尔' +
  '讯记访评证词试诉诊谈谁调谢挥换损抢护择担拟挂复'

function hasSimplified(s: string): boolean {
  return [...s].some((c) => SIMPLIFIED_ONLY.includes(c))
}

/** Traditional Chinese, or nothing. A wrong-language answer and a mixed-script
 *  one degrade the same way: to '', so the caller falls back to the original. */
export function isTraditionalChinese(s: string): boolean {
  return hasHan(s) && !hasSimplified(s)
}

/**
 * The market link, or null — which is what most articles must produce.
 *
 * Fails closed at every step. Anything that is not an array, an empty list, a
 * name that is not one of the six: all become null rather than a partial link.
 * This field is the newest and least trustworthy thing the model emits, and it
 * sits next to fields that have been working for months; nothing it gets wrong
 * may cost them.
 *
 * An empty answer becomes null rather than an empty array. There is no
 * difference between "the model considered it and found nothing" and "there is
 * no link" once the row is written, and a column that is null for the great
 * majority of rows says so more plainly than one full of `[]`.
 */
export function validateMarketLink(raw: unknown): MarketLink | null {
  if (!Array.isArray(raw)) return null

  const commodities = [...new Set(
    raw
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim().toUpperCase())
      .filter((c): c is MarketCommodity =>
        VALID_MARKET_COMMODITIES.includes(c as MarketCommodity)),
  )].slice(0, 3)

  return commodities.length > 0 ? commodities : null
}

export function validateClassification(raw: Record<string, unknown>): OllamaClassification {
  // Validate category
  let category = raw.category as string
  if (!VALID_CATEGORIES.includes(category as EventCategory)) {
    category = 'POLITICAL' // default per README spec
  }

  // Validate intensity
  let intensity = raw.intensity as string
  if (!VALID_INTENSITIES.includes(intensity as EventIntensity)) {
    intensity = 'LOW'
  }

  // Validate location.
  //
  // Roughly half the geo articles come back with a good label and a null
  // lat/lng, so the label is put through the gazetteer here rather than being
  // patched up per-render in the client. Resolving once, at write time, is
  // what lets the coordinates be persisted and every consumer — markers,
  // clustering, region panel, agent queries — see the same answer.
  const loc = (raw.location ?? {}) as Record<string, unknown>
  const locType = loc.type === 'orbital' ? 'orbital' : 'geo'
  const locLabel = String(loc.label ?? '').trim()
  const geo = locType === 'geo'
    ? resolveLocation(locLabel, loc.lat as number | null, loc.lng as number | null)
    : { lat: null, lng: null, precision: 'none' as const }

  // Chinese fields must actually be Chinese; otherwise drop them so the UI
  // falls back to the original rather than showing English twice.
  const titleZh   = cleanText(raw.title_zh, 40)
  const summaryZh = cleanText(raw.summary_zh, 120)

  return {
    category: category as EventCategory,
    intensity: intensity as EventIntensity,
    title_zh:   isTraditionalChinese(titleZh)   ? titleZh   : '',
    summary_zh: isTraditionalChinese(summaryZh) ? summaryZh : '',
    summary_en: cleanText(raw.summary_en, 200),
    location: {
      type:      locType,
      label:     locLabel,
      lat:       geo.lat,
      lng:       geo.lng,
      precision: geo.precision,
      body:      locType === 'orbital' ? String(loc.body ?? '') || null : null,
    },
    actors:        Array.isArray(raw.actors) ? raw.actors.map(String) : [],
    sources_count: typeof raw.sources_count === 'number' ? raw.sources_count : 1,
    tags:          Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    reliability:   VALID_RELIABILITIES.includes(raw.reliability as SourceReliability)
                     ? (raw.reliability as SourceReliability)
                     : 'UNVERIFIED',
    market_link:   validateMarketLink(raw.market_link),
  }
}

// ── Worker loop ─────────────────────────────────────────

async function processOne(article: Article, io: Server): Promise<void> {
  let attempts = 0
  while (attempts < 2) {
    try {
      const data = await callOllama(article.title, article.content)
      const heatScore = calculateHeatScore(data)
      const expiresAt = calculateExpiresAt(heatScore)

      // Event matching is deliberately not called here yet. The matcher and its
      // column are in place and covered, but a dry run over the stored corpus
      // still splits the Conakry collapse in two and files one of its reports
      // with floods in Venezuela. Stage 1 exists to put a true source count on
      // screen; a count drawn from that grouping would teach nothing. Wire this
      // up when scripts/backfill-events.ts --dry-run reads clean.
      markAnalyzed(article.id, data, heatScore, expiresAt)

      // Re-read from DB to get the full row, then broadcast
      const updated = getArticleById(article.id)
      if (updated) {
        broadcastEvent(io, articleToClientEvent(updated))
      }

      logger.debug('[Ollama]', `Classified: "${article.title.slice(0, 50)}…" → ${data.category} (heat=${heatScore})`)
      return
    } catch (err) {
      attempts++
      if (attempts >= 2) {
        logger.error('[Ollama]', `Failed 2x for "${article.title.slice(0, 50)}…":`, (err as Error).message)
      }
    }
  }

  // Both attempts failed
  markAnalysisFailed(article.id)
}

// Guard against overlapping runs: the 30s cron and the startup timer (or a
// long-running batch) can otherwise fire concurrently and both grab the same
// pending rows, doubling Ollama load and wasting work on duplicates.
let isProcessing = false

async function processPendingArticles(io: Server): Promise<void> {
  if (isProcessing) return
  isProcessing = true
  try {
    const pending = getPendingArticles(20)
    if (pending.length === 0) return

    logger.info('[Ollama]', `Processing ${pending.length} pending article(s)`)
    for (const article of pending) {
      await processOne(article, io)
    }
  } finally {
    isProcessing = false
  }
}

// The model's own failures are handled in `processOne`; what escapes to here is
// a SQLite read or write throwing. Nobody awaits the poll, so an escape would
// be an unhandled rejection and the process would go down with it — taking the
// API port and every other worker along for a fault in one batch of articles.
const runPending = (io: Server) => processPendingArticles(io).catch((err) =>
  logger.error('[Ollama]', 'Worker run failed:', (err as Error).message))

export function startOllamaWorker(io: Server): void {
  // On startup: reset failed articles so they get another chance
  const retried = resetFailedArticles()
  if (retried > 0) {
    logger.info('[Ollama]', `Reset ${retried} previously-failed article(s) for retry`)
  }

  // Poll every 30 seconds
  cron.schedule('*/30 * * * * *', () => {
    void runPending(io)
  })

  // Also run once after a short delay
  setTimeout(() => void runPending(io), 5000)

  logger.info('[Ollama]', 'Worker scheduled — polling every 30s')
}
