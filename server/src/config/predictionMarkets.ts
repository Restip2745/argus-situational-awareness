/**
 * The prediction markets this dashboard watches, maintained by hand.
 *
 * Stage 1 of the prediction feature is this file and nothing else: no matching,
 * no text similarity, no model in the path. That is the point. Polymarket's
 * market space is open-ended free text, and a market matched to the wrong story
 * renders as a perfectly ordinary "73%" beside it — the same failure the ticker
 * rules exist to prevent, except tickers could be pinned to Wikidata and
 * questions cannot. A list nobody generates is a list nothing can get wrong.
 *
 * It also settles a question automatic selection would keep asking: some
 * markets are on subjects this interface has no business putting beside the
 * news (casualty counts, death pools). Hand-picking excludes them by
 * construction rather than by filter.
 *
 * `category` is the same nine-way vocabulary the events use, so the panel can
 * group these rows the way the rest of the interface groups everything else.
 * A market that fits none of them does not belong on the watchlist.
 *
 * ── Maintenance ──────────────────────────────────────────────────────────────
 *
 * This list goes stale on its own: markets resolve, and a resolved slug drops
 * out of the reply silently, because on the panel a market that ended and a
 * market that never existed are the same absence. The route logs which slugs
 * came back with nothing, which is the signal to come and prune.
 *
 * UNVERIFIED: every slug below is a plausible guess, written without network
 * access to check it. Expect the first run against the live API to report most
 * or all of them missing, and replace them with slugs read off the market pages
 * themselves — the slug is the last path segment of a polymarket.com/event/…
 * URL. The list is deliberately short; a watchlist long enough to need scrolling
 * has stopped answering "what is the world betting on" and started being a feed.
 */

import type { EventCategory } from '../types'

export interface WatchedMarket {
  /** Slug as it appears in the market's URL. Validated before it is forwarded. */
  slug:     string
  /** Which of the nine categories this belongs under, for grouping. */
  category: EventCategory
}

export const WATCHED_MARKETS: WatchedMarket[] = [
  // ── Armed conflict ───────────────────────────────────────
  { slug: 'russia-ukraine-ceasefire-in-2026',            category: 'ARMED_CONFLICT' },
  { slug: 'israel-hamas-ceasefire-by-december-31-2026',  category: 'ARMED_CONFLICT' },

  // ── Political ────────────────────────────────────────────
  { slug: 'us-government-shutdown-in-2026',              category: 'POLITICAL' },
  { slug: 'new-uk-prime-minister-in-2026',               category: 'POLITICAL' },

  // ── Economic ─────────────────────────────────────────────
  // The status bar already carries oil, gold and copper as prices. These answer
  // the question those cannot: not what a thing costs now, but what is expected
  // of the decision that moves everything else.
  { slug: 'fed-rate-cut-in-september-2026',              category: 'ECONOMIC' },
  { slug: 'us-recession-in-2026',                        category: 'ECONOMIC' },

  // ── Science / tech ───────────────────────────────────────
  { slug: 'openai-releases-gpt-6-in-2026',               category: 'SCIENCE_TECH' },

  // ── Space ────────────────────────────────────────────────
  { slug: 'starship-orbital-refueling-in-2026',          category: 'SPACE' },

  // ── Health ───────────────────────────────────────────────
  { slug: 'who-declares-a-public-health-emergency-in-2026', category: 'HEALTH' },
]

/** The slugs alone, in list order — what the route forwards by default. */
export const WATCHED_SLUGS: string[] = WATCHED_MARKETS.map((m) => m.slug)

/** Category lookup for a slug, so the panel need not be sent the table twice. */
export function categoryOf(slug: string): EventCategory | null {
  return WATCHED_MARKETS.find((m) => m.slug === slug)?.category ?? null
}
