/**
 * Polymarket, as a prediction source.
 *
 * Not the default, for one reason that has nothing to do with the data: the
 * domain is DNS-blocked in Taiwan and in other jurisdictions that treat it as
 * gambling, and a reader there gets an empty panel however well this file
 * works. Where it does resolve it is the better source for live geopolitics —
 * ceasefires, strikes, elections in progress — which is most of what this
 * dashboard is about and precisely where Kalshi is thin.
 *
 * UNVERIFIED, and knowingly so: every field read here is assumed rather than
 * observed, because the upstream could not be reached from the machine this was
 * written on. `parseMarket` is separated from the fetch so it can be checked
 * against a saved payload the day someone can obtain one.
 */

import type {
  PredictionMarket, PredictionProvider, PricePoint, PriceSeries, PriceWindow,
} from './types'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API  = 'https://clob.polymarket.com'
const SITE      = 'https://polymarket.com'

/**
 * Volume below which a market is dropped, in USD actually matched.
 *
 * Lower than Kalshi's floor and not comparable to it: this source reports
 * dollars matched where the other reports contracts that settle at a dollar
 * each. The same real activity produces a larger number there.
 *
 * UNVERIFIED: wants calibrating against the real distribution.
 */
export const MIN_VOLUME_USD = 10_000

/** Windows this source names differently from the way callers ask. */
const CLOB_INTERVAL: Record<PriceWindow, string> = {
  '1d': '1d',
  '1w': '1w',
  '1m': '1m',
}

// ── Reading the payload ──────────────────────────────────────────────────────

/**
 * A finite number from a field that may arrive as either a number or a string.
 *
 * Assumed: this source JSON-encodes several numeric fields, and at least one
 * array arrives as a string containing JSON.
 */
const toNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const toStr = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null

/** An array that may arrive as an array or as a string containing one. */
const toArray = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

const toIso = (v: unknown): string | null => {
  const s = toStr(v)
  if (s === null) return null
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

interface GammaMarket {
  question?:          unknown
  outcomes?:          unknown
  outcomePrices?:     unknown
  clobTokenIds?:      unknown
  oneDayPriceChange?: unknown
  volumeNum?:         unknown
  volume?:            unknown
  endDate?:           unknown
  closed?:            unknown
  active?:            unknown
  archived?:          unknown
  events?:            unknown
}

/**
 * One market from one record, or null if it is not a row a panel can draw.
 *
 * The refusals mirror the other provider's, because the failures they prevent
 * are the same ones: a multi-outcome market told as a single row, a settled
 * market rendering as live conviction, a degenerate price, a market too thin
 * for its price to mean anything.
 */
export function parseMarket(
  body: unknown,
  id: string,
  now: number = Date.now(),
): PredictionMarket | null {
  const record: GammaMarket | undefined = Array.isArray(body)
    ? (body[0] as GammaMarket | undefined)
    : (body as GammaMarket | undefined)
  if (!record) return null

  if (record.closed === true || record.archived === true || record.active === false) return null

  const question = toStr(record.question)
  if (question === null) return null

  const outcomes = toArray(record.outcomes)
  const prices   = toArray(record.outcomePrices)
  if (!outcomes || !prices) return null
  if (outcomes.length !== 2 || prices.length !== 2) return null

  // Position is a convention; reading index 0 would report 77% for a market
  // priced at 23% the moment the source reversed the pair.
  const yesIndex = outcomes.findIndex(
    (o) => typeof o === 'string' && o.trim().toLowerCase() === 'yes',
  )
  if (yesIndex === -1) return null

  const price = toNum(prices[yesIndex])
  if (price === null) return null
  if (price <= 0 || price >= 1) return null

  const volumeUsd = toNum(record.volumeNum) ?? toNum(record.volume)
  if (volumeUsd === null || volumeUsd < MIN_VOLUME_USD) return null

  const resolvesAt = toIso(record.endDate)
  if (resolvesAt !== null && Date.parse(resolvesAt) < now) return null

  // Absent rather than zero when the source is silent: "did not move" and "was
  // not told" are different facts. Unlike Kalshi, this one does name the
  // period, so it can be taken at its word.
  const dayChange = toNum(record.oneDayPriceChange)

  const tokenIds = toArray(record.clobTokenIds)
  const yesToken = tokenIds?.[yesIndex]

  return {
    id,
    provider: 'polymarket',
    question,
    price,
    change24hPoints: dayChange === null ? null : dayChange * 100,
    volumeUsd,
    resolvesAt,
    asOf: new Date(now).toISOString(),
    url: marketUrl(record, id),
    historyKey: typeof yesToken === 'string' && yesToken !== '' ? yesToken : null,
  }
}

/**
 * The page a reader should land on.
 *
 * Prefers the parent event, where the resolution criteria and the depth are
 * legible. The slug is re-validated on the way out because this one came from
 * the payload rather than from the repo.
 */
function marketUrl(record: GammaMarket, id: string): string {
  const events = toArray(record.events)
  const first = events?.[0] as { slug?: unknown } | undefined
  const eventSlug = toStr(first?.slug)
  if (eventSlug !== null && polymarket.isValidId(eventSlug)) return `${SITE}/event/${eventSlug}`
  return `${SITE}/market/${id}`
}

/**
 * The points from one history response, or null.
 *
 * Gaps and out-of-range prices are dropped rather than filled or clamped: a
 * clamped point is a price nobody ever paid.
 */
export function parsePriceHistory(body: unknown, id: string): PriceSeries | null {
  const raw = (body as { history?: unknown })?.history
  if (!Array.isArray(raw)) return null

  const points: PricePoint[] = []
  for (const entry of raw) {
    const e = entry as { t?: unknown; p?: unknown }
    const t = toNum(e?.t)
    const p = toNum(e?.p)
    if (t === null || p === null) continue
    if (p <= 0 || p >= 1) continue
    points.push({ t: new Date(t * 1000).toISOString(), price: p })
  }

  if (points.length === 0) return null
  return { id, points }
}

// ── Fetching ─────────────────────────────────────────────────────────────────

async function get(url: string): Promise<unknown | null> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(10_000),
  })
  // A retired slug answers with an empty list rather than a 404, and either is
  // an ordinary outcome for a hand-maintained watchlist.
  if (!res.ok) return null
  return res.json()
}

export const polymarket: PredictionProvider = {
  name: 'polymarket',

  /** Slugs, which this source writes in lower case with dashes. */
  isValidId(id: string): boolean {
    return /^[a-z0-9][a-z0-9-]{0,127}$/.test(id)
  },

  async fetchMarket(id: string): Promise<PredictionMarket | null> {
    const body = await get(`${GAMMA_API}/markets?slug=${encodeURIComponent(id)}&limit=1`)
    return body === null ? null : parseMarket(body, id)
  },

  async fetchSeries(market: PredictionMarket, window: PriceWindow): Promise<PriceSeries | null> {
    if (market.historyKey === null) return null
    const body = await get(
      `${CLOB_API}/prices-history?market=${encodeURIComponent(market.historyKey)}` +
      `&interval=${CLOB_INTERVAL[window]}`,
    )
    return body === null ? null : parsePriceHistory(body, market.id)
  },
}
