/**
 * Kalshi, as a prediction source.
 *
 * A CFTC-regulated exchange rather than an offshore venue, which is most of
 * why it is the default: it resolves where Polymarket does not, and its
 * payload carries two things this panel had to work around before — a category
 * on every event, and the resolution rules as text.
 *
 * Everything read below was checked against live responses rather than
 * documentation, and the shapes in the interfaces are what actually came back.
 * Two of them are worth knowing before reading the parser:
 *
 * **Numbers arrive as strings.** `last_price_dollars` is `"0.6300"`, volumes
 * are `"117840.87"`. Being strict about the type would drop every row.
 *
 * **A question is an event, not a market.** The event carries the wording, the
 * category and whether the field is mutually exclusive; the markets under it
 * are the outcomes. A yes/no question is an event with exactly one market —
 * which is the only shape this panel accepts, for the reason `parseEvent`
 * gives.
 */

import { logger } from '../../utils/logger'
import type {
  PredictionMarket, PredictionProvider, PricePoint, PriceSeries, PriceWindow,
} from './types'
import { WINDOW_MS } from './types'

const API  = 'https://api.elections.kalshi.com/trade-api/v2'
const SITE = 'https://kalshi.com'

/**
 * Volume below which a market is dropped.
 *
 * In contracts, each settling at a dollar. Higher than the Polymarket floor
 * looks because it is not the same measure — see `volumeUsd` — and calibrated
 * against what the exchange actually holds: the open single-market events with
 * any real interest run from a few thousand contracts into the millions, while
 * the untraded ones sit at exactly zero. This is set to exclude the long tail
 * of listings nobody has touched, not to demand a busy market.
 */
export const MIN_VOLUME = 5_000

// ── Reading the payload ──────────────────────────────────────────────────────

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

const toIso = (v: unknown): string | null => {
  const s = toStr(v)
  if (s === null) return null
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

interface KalshiMarket {
  ticker?:                unknown
  status?:                unknown
  market_type?:           unknown
  last_price_dollars?:    unknown
  volume_fp?:             unknown
  open_interest_fp?:      unknown
  close_time?:            unknown
  expiration_time?:       unknown
}

interface KalshiEvent {
  event_ticker?:       unknown
  series_ticker?:      unknown
  title?:              unknown
  sub_title?:          unknown
  category?:           unknown
  mutually_exclusive?: unknown
  markets?:            unknown
}

/**
 * One market from one event, or null if it is not a row this panel can draw.
 *
 * The refusals, in order:
 *
 * **A field rather than a question.** `mutually_exclusive` marks an event whose
 * markets are rival outcomes — "who will be the next Secretary General of
 * NATO" arrives as eight of them. Each is individually binary, so a guard that
 * only checked the market would pass every one, and a row reading "Kaja Kallas
 * 9%" would tell a reader nothing about whether the other 91% is one opponent
 * or seven. The market count is checked as well as the flag: an event can carry
 * several markets without being marked exclusive — different strikes on the
 * same underlying — and the watchlist has no way to say which of them it meant.
 *
 * **Not trading.** A settled or suspended market renders exactly like live
 * conviction, which is worse than a stale quote: it is a certainty displayed as
 * a forecast.
 *
 * **Never traded.** A price of exactly zero is not an opinion; it is a listing
 * nobody has touched. The exchange lists a great many of these.
 *
 * **Thin.** See `MIN_VOLUME`.
 *
 * `now` is injectable so the close-time rule can be tested against a fixed date
 * rather than whenever the suite happens to run.
 */
export function parseEvent(
  body: unknown,
  id: string,
  now: number = Date.now(),
): PredictionMarket | null {
  // The single-event endpoint wraps its answer; the list endpoint does not.
  const wrapper = body as { event?: KalshiEvent } | KalshiEvent | null
  const event: KalshiEvent | undefined =
    (wrapper as { event?: KalshiEvent })?.event ?? (wrapper as KalshiEvent | undefined) ?? undefined
  if (!event) return null

  if (event.mutually_exclusive === true) return null

  const markets = Array.isArray(event.markets) ? event.markets as KalshiMarket[] : null
  if (!markets || markets.length !== 1) return null
  const market = markets[0]

  if (toStr(market.status) !== 'active') return null
  if (toStr(market.market_type) !== 'binary') return null

  const title = toStr(event.title)
  if (title === null) return null
  // The horizon lives in its own field — "Before 2099" under "Will Elon Musk
  // visit Mars in his lifetime?" — and a question without it is a different
  // question. Joined, not rewritten: both halves are the source's own words.
  const subTitle = toStr(event.sub_title)
  const question = subTitle === null ? title : `${title} — ${subTitle}`

  const price = toNum(market.last_price_dollars)
  if (price === null) return null
  if (price <= 0 || price >= 1) return null

  const volume = toNum(market.volume_fp)
  if (volume === null || volume < MIN_VOLUME) return null

  const resolvesAt = toIso(market.close_time) ?? toIso(market.expiration_time)
  if (resolvesAt !== null && Date.parse(resolvesAt) < now) return null

  const ticker = toStr(market.ticker)
  const seriesTicker = toStr(event.series_ticker)

  return {
    id,
    provider: 'kalshi',
    question,
    price,
    // Filled in by `fetchMarket` from the series, which is the only place the
    // period can be established. Nothing in the market payload states one.
    change24hPoints: null,
    volumeUsd: volume,
    resolvesAt,
    asOf: new Date(now).toISOString(),
    url: `${SITE}/markets/${encodeURIComponent(id)}`,
    // Both halves are needed to address the history endpoint, and neither is
    // meaningful above the provider boundary.
    historyKey: ticker !== null && seriesTicker !== null ? `${seriesTicker}|${ticker}` : null,
  }
}

interface KalshiCandle {
  end_period_ts?: unknown
  price?:         { close_dollars?: unknown; previous_dollars?: unknown }
}

/**
 * The points from one candlestick response, or null.
 *
 * `close_dollars` is the last trade inside the period and is absent when
 * nothing traded; `previous_dollars` is what the price already was, and is
 * always present. Taking the close where there is one and the previous price
 * otherwise gives the last traded price at every point, which is the same
 * quantity the live row shows.
 *
 * Deliberately not the mid of the book, though the payload offers it. It would
 * be a better estimate of what the market thinks and a worse row, because the
 * live price is a last trade: a series on one definition under a number on
 * another produces a chart that disagrees with its own final point.
 */
export function parseCandles(body: unknown, id: string): PriceSeries | null {
  const raw = (body as { candlesticks?: unknown })?.candlesticks
  if (!Array.isArray(raw)) return null

  const points: PricePoint[] = []
  for (const entry of raw as KalshiCandle[]) {
    const ts = toNum(entry?.end_period_ts)
    const price = toNum(entry?.price?.close_dollars) ?? toNum(entry?.price?.previous_dollars)
    if (ts === null || price === null) continue
    // Out of range is dropped rather than clamped: a clamped point is a price
    // nobody ever paid.
    if (price <= 0 || price >= 1) continue
    points.push({ t: new Date(ts * 1000).toISOString(), price })
  }

  if (points.length === 0) return null
  // Sorted defensively: the exchange hands these over in order, and nothing
  // downstream should depend on that staying true.
  points.sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
  return { id, points }
}

/**
 * The daily move implied by a series, in percentage points, or null.
 *
 * Derived rather than read off the market. The payload does carry a
 * `previous_price_dollars`, and on the markets checked it agreed with the price
 * a day earlier — but the field does not say over what period it is measured,
 * and a column labelled as a daily move cannot rest on a coincidence that held
 * twice. The series says exactly what it says.
 *
 * Null when the series does not reach a full day back, for the reason the
 * client's own version gives: a shorter window answers a different question
 * than the column asks, quietly.
 */
export function dailyMovePoints(series: PriceSeries, now: number = Date.now()): number | null {
  const at = (instant: number): number | null => {
    let found: number | null = null
    for (const p of series.points) {
      if (Date.parse(p.t) <= instant) found = p.price
      else break
    }
    return found
  }
  const latest = at(now)
  const dayAgo = at(now - WINDOW_MS['1d'])
  if (latest === null || dayAgo === null) return null
  return (latest - dayAgo) * 100
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/**
 * How long a candlestick period to ask for.
 *
 * Hourly. The exchange offers finer, and finer would be a larger payload
 * telling the timeline nothing it can show: the scrub covers a day across a few
 * hundred pixels, and these markets do not move minute to minute anyway.
 */
const PERIOD_MINUTES = 60

async function get(path: string): Promise<unknown | null> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(10_000),
  })
  // A retired ticker answers 404, an ordinary outcome: the watchlist is
  // maintained by hand and drifts behind markets that have settled.
  if (!res.ok) return null
  return res.json()
}

/**
  * How far back to ask when the answer wanted is a daily move.
  *
  * Deliberately more than a day. The move is measured from the last price at or
  * before 24 hours ago, and a request that starts exactly 24 hours ago returns
  * its first candle a little *after* that instant — so there is no point at or
  * before it and the column comes back empty, on every row, for a reason
  * nothing in the payload hints at. The margin is the difference between a
  * column that works and one that is silently always blank.
  */
const DAILY_MOVE_SPAN_MS = 30 * 60 * 60 * 1000

async function fetchCandles(
  market: PredictionMarket,
  spanMs: number,
  now: number,
): Promise<PriceSeries | null> {
  if (market.historyKey === null) return null
  const [series, ticker] = market.historyKey.split('|')
  if (!series || !ticker) return null

  const end = Math.floor(now / 1000)
  const start = Math.floor((now - spanMs) / 1000)
  const body = await get(
    `/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}` +
    `/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${PERIOD_MINUTES}`,
  )
  return body === null ? null : parseCandles(body, market.id)
}

export const kalshi: PredictionProvider = {
  name: 'kalshi',

  /**
   * Event tickers, which the exchange writes in upper case with dashes —
   * `KXIMPEACH-29`, `KXABRAHAMSA-29`, `CHINAUSGDP`.
   */
  isValidId(id: string): boolean {
    return /^[A-Z0-9][A-Z0-9-]{0,63}$/.test(id)
  },

  async fetchMarket(id: string): Promise<PredictionMarket | null> {
    const now = Date.now()
    const body = await get(`/events/${encodeURIComponent(id)}?with_nested_markets=true`)
    if (body === null) return null

    const market = parseEvent(body, id, now)
    if (market === null) return null

    // A second call, because nothing in the first one establishes a period for
    // a daily move. Costly enough to be worth naming: it doubles the requests
    // this provider makes, and it is why the caller caches rather than this.
    // A market that cannot be charted simply has no move to report.
    try {
      const series = await fetchCandles(market, DAILY_MOVE_SPAN_MS, now)
      if (series !== null) market.change24hPoints = dailyMovePoints(series, now)
    } catch (err) {
      logger.warn('[prediction]', `${id} daily move unavailable:`, (err as Error).message)
    }

    return market
  },

  fetchSeries(market: PredictionMarket, window: PriceWindow): Promise<PriceSeries | null> {
    return fetchCandles(market, WINDOW_MS[window], Date.now())
  },
}
