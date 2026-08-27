/**
 * Prices for named future events — the markets that have no ticker.
 *
 * Everything in `market.ts` looks backwards: a close, and how far it moved from
 * the one before it. That answers "did the market move on this". It cannot
 * answer "what is priced to happen", and for most of what this dashboard tracks
 * — elections, ceasefires, rate decisions, launch windows — there is no listed
 * instrument to ask in the first place. This module fills that one gap and
 * nothing else.
 *
 * Scope is deliberately one row of a panel: the question as written, the price
 * of its YES side, how far that moved in a day, when it resolves, and how much
 * has actually traded. No order book, no positions, no wallet. The panel links
 * out to the market page so a reader can check resolution criteria and depth at
 * the source; that link is the whole of the interaction.
 *
 * Fetched here rather than in the browser for the reasons `market.ts` gives —
 * one cache shared by every open panel, and the upstream's rate limit spent on
 * the server's terms.
 *
 * UNVERIFIED: every field name read below is assumed, not confirmed. The
 * upstream is documented, unlike Yahoo's chart endpoint, but nothing here has
 * been run against it — the response shape must be checked before this ships,
 * and `parseMarket` is split from the fetch so that can be done against a saved
 * payload rather than the live API.
 */

import { logger } from '../utils/logger'

/**
 * A binary market, or as much of one as a single row can honestly hold.
 */
export interface PredictionMarket {
  /** Market slug as requested — the cache key and the identity of the row. */
  slug:            string
  /** The question verbatim, never paraphrased. Two markets can ask what looks
   *  like the same thing and resolve on different criteria; the wording is the
   *  only place that difference is visible. */
  question:        string
  /** YES price as a fraction, 0–1. Kept in the upstream's own unit — the
   *  conversion to a percentage is a display decision. */
  price:           number
  /** One-day move in **percentage points**, or null when the upstream does not
   *  supply one. 20% to 25% is +5 points, not +25% — the percent-of-a-percent
   *  reading is wrong by a factor of five and looks entirely normal. */
  change24hPoints: number | null
  /** Lifetime traded volume, USD. Shown, not just filtered on: a price is only
   *  worth what stands behind it. */
  volumeUsd:       number
  /** Resolution date, ISO 8601, or null for a market with no fixed end. The
   *  reader must be told this for the same reason a quote carries its as-of
   *  date — a price with no horizon is not a claim about anything. */
  resolvesAt:      string | null
  /** When this price was read. Unlike a close, "now" here really is now: these
   *  trade continuously, so the fetch time is the honest timestamp. */
  asOf:            string
  /** The market's page upstream. Built from the parent event's slug where the
   *  payload carries one, since that is the page a reader wants — the market's
   *  own slug lands on a narrower view. */
  url:             string
  /** CLOB token id of the YES side, when the payload carries one. History is
   *  keyed on this rather than on the slug, so a market without it can be
   *  priced but not charted. */
  yesTokenId:      string | null
}

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API  = 'https://clob.polymarket.com'
const SITE      = 'https://polymarket.com'

/** Requests per call, sized to hold a curated watchlist in one round trip. */
export const MAX_SLUGS = 16

/**
 * How long a price stays fresh.
 *
 * A minute, against ten for a spot quote. The quote TTL was justified by the
 * market being shut most of the time, so the number could not change at all;
 * that reasoning does not survive here — these trade continuously, including
 * through exactly the overnight hours when a geopolitical event breaks and this
 * panel is worth reading.
 */
const MARKET_TTL = 60 * 1000

/**
 * Volume below which a market is dropped rather than shown.
 *
 * This is the dormant-GDR rule again. A market with a few hundred dollars
 * against it renders identically to one with millions — same percentage, same
 * row, same authority — and the thin one is frequently the more dramatic
 * number, because it takes almost nothing to move. Dropped rather than
 * annotated: a caveat under a number does not stop the number being read.
 *
 * UNVERIFIED: the threshold wants calibrating against the real distribution
 * once the payload can be sampled. This value is a placeholder, not a finding.
 */
export const MIN_VOLUME_USD = 10_000

const cache = new Map<string, { market: PredictionMarket | null; ts: number }>()

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * A finite number from a field that may arrive as either a number or a string.
 *
 * UNVERIFIED, but assumed: this upstream JSON-encodes several numeric fields,
 * and at least one array (`outcomePrices`) arrives as a string containing JSON.
 * Being strict about the type here would drop every row for a reason that has
 * nothing to do with the data.
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

/**
 * An array that may arrive as an array or as a string containing one.
 */
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
  slug?:              unknown
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
 * One market from one Gamma record, or null if it is not a row this panel can
 * honestly draw.
 *
 * Most of the length here is refusals, and they are the point. In order:
 *
 * **Not binary.** A five-way election market cannot be told in one row, and
 * showing its leading outcome silently discards the other four — the reader
 * sees "34%" with no indication that the remaining 66% is split rather than
 * opposed. Multi-outcome markets are dropped until there is a component that
 * can hold them.
 *
 * **Closed, archived, or past its end date.** A resolved market sits at 0.99
 * and renders exactly like live conviction. This is the failure the stale-quote
 * guard exists for in `market.ts`, and it is worse here: a settled market is
 * not merely old, it is a certainty being displayed as a forecast.
 *
 * **Degenerate prices.** Exactly 0 or exactly 1 is a settled or broken market,
 * never a live opinion.
 *
 * **Thin.** See `MIN_VOLUME_USD`.
 *
 * `now` is injectable so the end-date rule can be tested against a fixed date
 * rather than whenever the suite happens to run.
 */
export function parseMarket(
  body: unknown,
  slug: string,
  now: number = Date.now(),
): PredictionMarket | null {
  // The upstream answers a slug query with an array, so a single record and a
  // one-element list are both ordinary shapes to receive.
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

  // YES is conventionally first, but conventions are not guarantees when the
  // row being drawn is a probability — read the label rather than the position.
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

  // Absent rather than zero when the upstream is silent: "no move" and "not
  // told" are different facts, and the view can only tell them apart if the
  // parse layer does.
  // UNVERIFIED: assumed to be a fraction on the same scale as the price.
  const dayChange = toNum(record.oneDayPriceChange)

  const tokenIds = toArray(record.clobTokenIds)
  const yesToken = tokenIds?.[yesIndex]

  return {
    slug,
    question,
    price,
    change24hPoints: dayChange === null ? null : dayChange * 100,
    volumeUsd,
    resolvesAt,
    asOf: new Date(now).toISOString(),
    url: marketUrl(record, slug),
    yesTokenId: typeof yesToken === 'string' && yesToken !== '' ? yesToken : null,
  }
}

/**
 * The page a reader should land on.
 *
 * Prefers the parent event's slug: a market frequently belongs to an event that
 * frames it, and the event page is where the resolution criteria and the volume
 * are legible. Falls back to the market's own slug, which always resolves to
 * something even when the payload carries no event.
 *
 * The slug is re-validated on the way out even though it was validated on the
 * way in, because this one came from the payload rather than from the caller.
 */
function marketUrl(record: GammaMarket, slug: string): string {
  const events = toArray(record.events)
  const first = events?.[0] as { slug?: unknown } | undefined
  const eventSlug = toStr(first?.slug)
  if (eventSlug !== null && isValidSlug(eventSlug)) return `${SITE}/event/${eventSlug}`
  return `${SITE}/market/${slug}`
}

/**
 * Slugs this proxy is willing to forward.
 *
 * Stage 1 slugs come from a file in the repo rather than from a model or a
 * user, so this is not guarding against an adversary — but the value is
 * interpolated into an outbound URL and into an anchor href, and a whitelist is
 * cheaper than reasoning about either.
 */
export function isValidSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,127}$/.test(s)
}

// ── History ──────────────────────────────────────────────────────────────────

/**
 * A price series, for the timeline.
 *
 * This is the one place prediction data fits the interface better than equities
 * do. The scrub rewinds the whole UI to a moment, and a daily close has nothing
 * to say about a moment — which is why the live-only layers hide in retrospect
 * mode. A market that trades continuously does have a shape at 03:00, so these
 * rows can stay on screen while the timeline moves instead of disappearing.
 *
 * Keyed on the CLOB token id, not the slug: the price history lives on a
 * different service from the market metadata, and that service addresses the
 * YES side directly. A market whose payload carries no token id can be priced
 * but not charted — `yesTokenId` is null and the caller draws no line.
 */
export interface PricePoint {
  /** ISO 8601. */
  t:     string
  /** YES price as a fraction, 0–1, on the same scale as `PredictionMarket`. */
  price: number
}

export interface PriceSeries {
  slug:   string
  points: PricePoint[]
}

/**
 * Windows this proxy will forward, as an allowlist.
 *
 * `1d` is the one the timeline needs; the rest are here because the panel will
 * want a horizon longer than the scrub, and adding them later would mean
 * touching the validator, the route and the cache key for a string change.
 */
export const VALID_WINDOWS = ['1d', '1w', '1m', 'max'] as const
export type PriceWindow = typeof VALID_WINDOWS[number]

export function isValidWindow(w: string): w is PriceWindow {
  return (VALID_WINDOWS as readonly string[]).includes(w)
}

/**
 * The points from one history response, or null if the shape is not what it
 * claims.
 *
 * Out-of-range prices are dropped rather than clamped, on the same reasoning
 * that gaps in a close series are dropped rather than interpolated: a clamped
 * point is a price nobody ever paid.
 */
export function parsePriceHistory(body: unknown, slug: string): PriceSeries | null {
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
  return { slug, points }
}

/**
 * How long a series stays fresh.
 *
 * Five minutes against sixty seconds for a price. The last point moves as often
 * as the price does, but the payload is orders of magnitude larger and the
 * shape of a line does not change meaningfully within a minute — the trade-off
 * runs the other way from the price cache, as it does in `market.ts`.
 */
const HISTORY_TTL = 5 * 60 * 1000

const historyCache = new Map<string, { series: PriceSeries | null; ts: number }>()

async function fetchOneHistory(
  slug: string,
  tokenId: string,
  window: PriceWindow,
): Promise<PriceSeries | null> {
  const url = `${CLOB_API}/prices-history?market=${encodeURIComponent(tokenId)}&interval=${window}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  return parsePriceHistory(await res.json(), slug)
}

/**
 * A price series for one market, or null.
 *
 * Takes the token id rather than looking it up, so the caller's existing
 * `fetchMarkets` result stays the only place the Gamma payload is read.
 */
export async function fetchHistory(
  slug: string,
  tokenId: string,
  window: PriceWindow,
): Promise<PriceSeries | null> {
  if (!isValidSlug(slug)) return null
  const key = `${tokenId}|${window}`
  const hit = historyCache.get(key)
  if (hit && Date.now() - hit.ts < HISTORY_TTL) return hit.series

  try {
    const series = await fetchOneHistory(slug, tokenId, window)
    historyCache.set(key, { series, ts: Date.now() })
    return series
  } catch (err) {
    logger.warn('[prediction]', `${slug} history fetch failed:`, (err as Error).message)
    // Not cached: a timeout says nothing about whether the series exists.
    return null
  }
}

/**
 * Series for several markets at once, with unresolvable ones simply absent.
 *
 * This was one slug at a time to begin with, on the reasoning that a panel
 * charts the market a reader picked rather than all of them. The timeline
 * falsified that: scrubbing rewinds the whole interface, so every row has to
 * move together or the panel shows one price from an hour ago beside eight from
 * now. Fetched as a batch because that is how they are needed — one round trip
 * the first time a reader scrubs, served from cache after.
 */
export async function fetchHistories(
  markets: Array<{ slug: string; tokenId: string }>,
  window: PriceWindow,
): Promise<PriceSeries[]> {
  const wanted = markets.filter((m) => isValidSlug(m.slug)).slice(0, MAX_SLUGS)
  const series = await Promise.all(
    wanted.map((m) => fetchHistory(m.slug, m.tokenId, window)),
  )
  return series.filter((s): s is PriceSeries => s !== null)
}

// ── Fetching ─────────────────────────────────────────────────────────────────

async function fetchMarket(slug: string): Promise<PredictionMarket | null> {
  const url = `${GAMMA_API}/markets?slug=${encodeURIComponent(slug)}&limit=1`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(8000),
  })
  // A retired slug answers with an empty list rather than a 404, and either is
  // an ordinary outcome: the watchlist is maintained by hand and will drift
  // behind markets that have resolved.
  if (!res.ok) return null
  return parseMarket(await res.json(), slug)
}

/**
 * Markets for `slugs`, cached, with unresolvable ones simply absent.
 *
 * Same contract as `fetchQuotes`: a slug the upstream cannot serve is missing
 * from the reply rather than reported. On the panel, a market that has resolved
 * and a market that never existed are the same absence — and with a curated
 * list, both are a maintenance signal rather than something the reader needs to
 * be told about mid-session.
 *
 * Failures are cached alongside successes, for the reason the quote cache gives
 * — a slug that has resolved will not come back within the window.
 */
export async function fetchMarkets(slugs: string[]): Promise<PredictionMarket[]> {
  const wanted = [...new Set(slugs.filter(isValidSlug))].slice(0, MAX_SLUGS)
  const now = Date.now()

  const results = await Promise.all(wanted.map(async (slug) => {
    const hit = cache.get(slug)
    if (hit && now - hit.ts < MARKET_TTL) return hit.market

    try {
      const market = await fetchMarket(slug)
      cache.set(slug, { market, ts: now })
      return market
    } catch (err) {
      logger.warn('[prediction]', `${slug} fetch failed:`, (err as Error).message)
      // Not cached: a timeout says nothing about whether the market exists.
      return null
    }
  }))

  return results.filter((m): m is PredictionMarket => m !== null)
}
