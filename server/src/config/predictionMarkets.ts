/**
 * The prediction markets this dashboard watches, maintained by hand.
 *
 * Stage 1 of the prediction feature is this file and nothing else: no matching,
 * no text similarity, no model in the path. That is the point. Market spaces
 * are open-ended free text, and a market attached to the wrong story renders as
 * a perfectly ordinary "73%" beside it — the same failure the ticker rules
 * exist to prevent, except tickers could be pinned to Wikidata and questions
 * cannot. A list nobody generates is a list nothing can get wrong.
 *
 * It also settles a question automatic selection would keep asking: some
 * markets are on subjects this interface has no business putting beside the
 * news. Hand-picking excludes them by construction rather than by filter, and
 * on an exchange that lists thousands of sports lines it also does the more
 * mundane job of keeping parlays off a situational-awareness panel.
 *
 * `category` is the same nine-way vocabulary the events use, so the panel can
 * group these rows the way the rest of the interface groups everything else.
 * Kalshi supplies a category of its own — World, Politics, Economics — but it
 * is not this one, and mapping between two taxonomies automatically would put
 * rows under headings their maintainer never chose. The heading is stated here
 * instead.
 *
 * ── Maintenance ──────────────────────────────────────────────────────────────
 *
 * These lists go stale on their own: markets resolve, and a resolved id drops
 * out of the reply silently, because on the panel it is indistinguishable from
 * one that never existed. The route logs which ids came back with nothing,
 * which is the signal to come and prune.
 */

import type { EventCategory } from '../types'
import type { ProviderName } from '../services/prediction'

export interface WatchedMarket {
  /** Provider-scoped id: a Kalshi event ticker, or a Polymarket slug. */
  id:         string
  /** Which of the nine categories this belongs under, for grouping. */
  category:   EventCategory
  /**
   * Countries this market is a reading of, by the names `countryData.ts` uses,
   * or absent for one that is about no country in particular.
   *
   * Stated here rather than derived, and that is the whole design. The plan had
   * been to attach markets to countries by the source's own tags — but of
   * Kalshi's 220 tags exactly four are countries (Iran, Brazil, Hungary, Peru),
   * incidentally rather than as a taxonomy, so there is nothing to read. The
   * alternative was matching country names against the question text, which
   * brings back the failure this feature was shaped to avoid, only smaller:
   * Turkey, Chad, Jordan and Georgia are each a country and each something
   * else.
   *
   * Left off deliberately where a market is about no country. A Mars landing is
   * not a reading of the United States, and filing it under one because the
   * rocket leaves from there would be the category error the index table
   * records about sector indices.
   */
  countries?: string[]
}

/**
 * Kalshi, and the default.
 *
 * Every entry below was read off a live response: single-market event, not
 * mutually exclusive, actively trading, and past the volume floor at the time
 * of writing. That is a stronger starting point than the Polymarket list has,
 * and it is still a starting point — a market that was liquid in August is not
 * necessarily liquid now.
 *
 * The shape of the list says something about the exchange. Kalshi is deep on
 * American politics and macroeconomics and thin on live conflict: there was no
 * Ukraine ceasefire market, no Taiwan market and no Iran market to be had among
 * the single-outcome events, so `ARMED_CONFLICT` — the category this dashboard
 * exists for — is represented by diplomatic normalisation rather than by
 * fighting. That gap is the honest reason the Polymarket provider is kept
 * rather than deleted.
 */
export const KALSHI_WATCHLIST: WatchedMarket[] = [
  // ── Armed conflict ───────────────────────────────────────
  // Normalisation rather than hostilities, for want of anything closer.
  { id: 'KXABRAHAMSA-29',  category: 'ARMED_CONFLICT', countries: ['Israel', 'Saudi Arabia'] },
  { id: 'KXABRAHAMSY-29',  category: 'ARMED_CONFLICT', countries: ['Israel', 'Syria'] },

  // ── Political ────────────────────────────────────────────
  { id: 'KXIMPEACH-29',    category: 'POLITICAL', countries: ['United States of America'] },
  // Panama has no entry in `countryData.ts` and so no panel to hang this on;
  // it is filed under the country whose action it is about.
  { id: 'KXCANAL-29',      category: 'POLITICAL', countries: ['United States of America'] },
  { id: 'KXFTAPRC-29',     category: 'POLITICAL', countries: ['United States of America', 'China'] },
  { id: 'KXCANTERRITORY-29', category: 'POLITICAL', countries: ['United States of America', 'Canada'] },

  // ── Economic ─────────────────────────────────────────────
  // The status bar already carries oil, gold and copper as prices. These answer
  // what those cannot: not what a thing costs now, but what is expected of it.
  { id: 'KXRECSSNBER-27',  category: 'ECONOMIC', countries: ['United States of America'] },
  { id: 'CHINAUSGDP',      category: 'ECONOMIC', countries: ['China', 'United States of America'] },

  // ── Science / tech ───────────────────────────────────────
  { id: 'NYTOAI-27DEC31',  category: 'SCIENCE_TECH', countries: ['United States of America'] },

  // ── Space ────────────────────────────────────────────────
  // No countries, deliberately: a Mars landing is a reading of none of them.
  { id: 'KXSPACEXMARS-30', category: 'SPACE' },
  { id: 'KXBLUESPACEX-30', category: 'SPACE' },
]

/**
 * Polymarket.
 *
 * UNVERIFIED, and differently so from the list above: these slugs are plausible
 * guesses written without access to the source, which is DNS-blocked in Taiwan
 * where this was assembled. Expect the first run against a network that
 * resolves the domain to report most or all of them missing, and replace them
 * with slugs read off the market pages — the slug is the last path segment of a
 * polymarket.com/event/… URL.
 */
export const POLYMARKET_WATCHLIST: WatchedMarket[] = [
  // ── Armed conflict ───────────────────────────────────────
  { id: 'russia-ukraine-ceasefire-in-2026',           category: 'ARMED_CONFLICT', countries: ['Russia', 'Ukraine'] },
  { id: 'israel-hamas-ceasefire-by-december-31-2026', category: 'ARMED_CONFLICT', countries: ['Israel'] },

  // ── Political ────────────────────────────────────────────
  { id: 'us-government-shutdown-in-2026',             category: 'POLITICAL', countries: ['United States of America'] },
  { id: 'new-uk-prime-minister-in-2026',              category: 'POLITICAL', countries: ['United Kingdom'] },

  // ── Economic ─────────────────────────────────────────────
  { id: 'fed-rate-cut-in-september-2026',             category: 'ECONOMIC', countries: ['United States of America'] },
  { id: 'us-recession-in-2026',                       category: 'ECONOMIC', countries: ['United States of America'] },

  // ── Science / tech ───────────────────────────────────────
  { id: 'openai-releases-gpt-6-in-2026',              category: 'SCIENCE_TECH' },

  // ── Space ────────────────────────────────────────────────
  { id: 'starship-orbital-refueling-in-2026',         category: 'SPACE' },
]

const WATCHLISTS: Record<ProviderName, WatchedMarket[]> = {
  kalshi:     KALSHI_WATCHLIST,
  polymarket: POLYMARKET_WATCHLIST,
}

/**
 * The watchlist for a provider.
 *
 * Per provider rather than one shared list, because an id is meaningless to the
 * source that did not issue it: switching provider and keeping the list would
 * ask Kalshi for `us-recession-in-2026` and get an empty panel that looks
 * exactly like an outage.
 */
export function watchlistFor(provider: ProviderName): WatchedMarket[] {
  return WATCHLISTS[provider]
}

export function watchedIds(provider: ProviderName): string[] {
  return watchlistFor(provider).map((m) => m.id)
}

/** Category lookup, so the panel need not be sent the table twice. */
export function categoryOf(provider: ProviderName, id: string): EventCategory | null {
  return watchlistFor(provider).find((m) => m.id === id)?.category ?? null
}

/**
 * Countries a market is a reading of, empty for one about no country.
 *
 * Sent with the row rather than served from a filter endpoint of its own: the
 * region panel wants the same watchlist the prediction panel already asks for,
 * and the same cached answer, so filtering it where it lands costs nothing and
 * keeps this table on one side of the wire.
 */
export function countriesOf(provider: ProviderName, id: string): string[] {
  return watchlistFor(provider).find((m) => m.id === id)?.countries ?? []
}
