/**
 * Prices for named future events — the markets that have no ticker.
 *
 * Everything in `market.ts` looks backwards: a close, and how far it moved from
 * the one before it. That answers "did the market move on this". It cannot
 * answer "what is priced to happen", and for most of what this dashboard tracks
 * — elections, ceasefires, rate decisions, launch windows — there is no listed
 * instrument to ask in the first place. This fills that one gap and nothing
 * else.
 *
 * Scope is one row of a panel: the question as written, the price of its YES
 * side, how far that moved in a day, when it resolves, and how much has
 * actually traded. No order book, no positions, no wallet. The panel links out
 * to the market page so a reader can check resolution criteria and depth at the
 * source; that link is the whole of the interaction.
 *
 * This file owns the two things neither source should own: which source is in
 * use, and the cache. Providers fetch and parse; nothing more.
 */

import { logger } from '../../utils/logger'
import { kalshi } from './kalshi'
import { polymarket } from './polymarket'
import type {
  PredictionMarket, PredictionProvider, PriceSeries, PriceWindow, ProviderName,
} from './types'

export * from './types'

const PROVIDERS: Record<ProviderName, PredictionProvider> = {
  kalshi,
  polymarket,
}

export function providerFor(name: ProviderName): PredictionProvider {
  return PROVIDERS[name]
}

/** Requests per call, sized to hold a curated watchlist in one round trip. */
export const MAX_IDS = 16

/**
 * How many upstream requests may be in flight at once.
 *
 * Learned the hard way rather than chosen. Firing a sixteen-row watchlist off
 * as sixteen parallel requests — thirty-two, in fact, since a market can need a
 * second call for its daily move — got roughly half of them throttled, and the
 * failures did not look like failures: the rows simply had no history and
 * vanished from the panel the moment anyone scrubbed. Requested one at a time
 * the very same ids all answered.
 *
 * Four is slower than sixteen and faster than one, and the cache means a reader
 * pays this once.
 */
const CONCURRENCY = 4

/**
 * `fn` over `items`, at most `CONCURRENCY` at a time, order preserved.
 *
 * Small enough to keep here rather than take a dependency for, and specific
 * enough that a general-purpose one would need explaining anyway.
 */
async function mapPool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker),
  )
  return out
}

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
 * How long a series stays fresh.
 *
 * Five minutes against sixty seconds for a price. The last point moves as often
 * as the price does, but the payload is orders of magnitude larger and the
 * shape of a line does not change meaningfully within a minute — the trade-off
 * runs the other way from the price cache, as it does in `market.ts`.
 */
const SERIES_TTL = 5 * 60 * 1000

/**
 * Caches are keyed by provider as well as by id.
 *
 * Not defensive tidiness: the two sources use different id spaces, and a
 * lowercase slug could in principle collide with nothing at all — but a reader
 * who switches provider in settings must not be served the previous source's
 * numbers under the new source's name, which is what a shared key would do.
 */
const marketCache = new Map<string, { market: PredictionMarket | null; ts: number }>()
const seriesCache = new Map<string, { series: PriceSeries | null; ts: number }>()

/**
 * Markets for `ids`, cached, with unresolvable ones simply absent.
 *
 * Same contract as `fetchQuotes`: an id the source cannot serve is missing from
 * the reply rather than reported. On the panel, a market that has resolved and
 * a market that never existed are the same absence — and with a curated list,
 * both are a maintenance signal rather than something the reader needs to be
 * told about mid-session.
 *
 * Failures are cached alongside successes, for the reason the quote cache
 * gives: a market that has resolved will not come back within the window.
 */
export async function fetchMarkets(
  ids: string[],
  providerName: ProviderName,
): Promise<PredictionMarket[]> {
  const provider = providerFor(providerName)
  const wanted = [...new Set(ids.filter((id) => provider.isValidId(id)))].slice(0, MAX_IDS)
  const now = Date.now()

  const results = await mapPool(wanted, async (id) => {
    const key = `${providerName}|${id}`
    const hit = marketCache.get(key)
    if (hit && now - hit.ts < MARKET_TTL) return hit.market

    try {
      const market = await provider.fetchMarket(id)
      marketCache.set(key, { market, ts: now })
      return market
    } catch (err) {
      logger.warn('[prediction]', `${providerName}/${id} fetch failed:`, (err as Error).message)
      // Not cached: a timeout says nothing about whether the market exists.
      return null
    }
  })

  return results.filter((m): m is PredictionMarket => m !== null)
}

/**
 * Series for several markets at once, with unresolvable ones simply absent.
 *
 * A batch because that is how the timeline needs them: scrubbing rewinds the
 * whole interface, so every row has to move together or the panel shows one
 * price from an hour ago beside eight from now.
 */
export async function fetchSeries(
  markets: PredictionMarket[],
  window: PriceWindow,
): Promise<PriceSeries[]> {
  const now = Date.now()

  const results = await mapPool(markets.slice(0, MAX_IDS), async (market) => {
    const key = `${market.provider}|${market.id}|${window}`
    const hit = seriesCache.get(key)
    if (hit && now - hit.ts < SERIES_TTL) return hit.series

    try {
      const series = await providerFor(market.provider).fetchSeries(market, window)
      // Only a hit is cached, unlike the market cache above, and the asymmetry
      // is the point. A market that cannot be found has almost certainly
      // resolved and will not reappear inside the window, so remembering the
      // miss saves a pointless retry. A series that cannot be found usually
      // means the request was throttled a moment ago — the market plainly
      // exists, its price is on screen — and remembering that miss would strand
      // the row un-rewindable for five minutes over a hiccup.
      if (series !== null) seriesCache.set(key, { series, ts: now })
      return series
    } catch (err) {
      logger.warn('[prediction]', `${market.provider}/${market.id} series failed:`, (err as Error).message)
      return null
    }
  })

  return results.filter((s): s is PriceSeries => s !== null)
}
