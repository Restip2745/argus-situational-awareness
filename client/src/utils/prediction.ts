/**
 * Presentation rules for a prediction market row.
 *
 * Here rather than inline in the panel for the reason `quote.ts` gives: these
 * are decisions, not formatting. Two of them are the difference between a row
 * that informs and one that misleads by a factor of five.
 */

import { quoteColor, formatAsOf, type UpColor } from './quote'

/**
 * The price, as a whole percentage.
 *
 * No decimal. The upstream quotes to the cent, so a decimal would be inventing
 * resolution the market does not have — and more to the point, nobody reading a
 * forecast needs to be told it is 23.4% rather than 23%. The spurious precision
 * would only make the number look more authoritative than it is.
 */
export function formatMarketPrice(price: number): string {
  if (!Number.isFinite(price)) return '—'
  return `${Math.round(price * 100)}%`
}

/**
 * The daily move, in percentage points, with the unit spelled out.
 *
 * The unit is not decoration. A market that went from 23% to 28% moved five
 * points; rendered as "+5.0%" a reader takes it for a percent change, which
 * would be +21.7% — wrong by a factor of four, and indistinguishable from
 * correct. Every market row elsewhere in this app is a percent change, so this
 * one has to say what it is instead of relying on context.
 *
 * Null renders as an em dash rather than as zero: the upstream not reporting a
 * move and the market not having moved are different facts.
 */
export function formatPoints(points: number | null): string {
  if (points === null || !Number.isFinite(points)) return '—'
  if (Math.abs(points) < 0.05) return '0.0 pts'
  return `${points > 0 ? '+' : ''}${points.toFixed(1)} pts`
}

/**
 * Colour for a daily move, under the reader's rise/fall convention.
 *
 * Delegates to the quote rule rather than restating it. The convention is about
 * direction, not about whether the news is good — a rising ceasefire price and
 * a rising oil price are opposite in sentiment and identical in the only thing
 * the colour claims.
 */
export function pointsColor(points: number | null, upColor: UpColor): string {
  return quoteColor(points ?? 0, upColor)
}

/**
 * When the market resolves, or an em dash for one with no fixed end.
 *
 * Same shape as a quote's as-of date, and deliberately the same function: both
 * columns answer "what date is this number attached to", and two formats for
 * one question would read as two different kinds of fact. The year appears
 * whenever it is not the current one, which is far more often here — most of
 * these resolve next year.
 */
export function formatResolves(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return '—'
  return formatAsOf(iso, now) || '—'
}

/**
 * Traded volume, short enough for a column.
 *
 * Shown rather than merely filtered on. The server drops markets too thin to
 * mean anything, but "above the floor" spans two orders of magnitude, and a
 * reader deciding how much weight to give a number deserves to see how much
 * money stands behind it.
 */
export function formatVolume(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '—'
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000)     return `$${Math.round(usd / 1_000)}K`
  return `$${Math.round(usd)}`
}

// ── Rewinding ────────────────────────────────────────────────────────────────

/** One point of a market's price series, as `/api/prediction/history` sends it. */
export interface PricePoint {
  /** ISO 8601. */
  t:     string
  /** YES price as a fraction, 0–1. */
  price: number
}

/**
 * The price at an instant, or null when the series cannot say.
 *
 * The last point *at or before* the instant, never the nearest one. Reaching
 * forward to the next print would show a price that did not exist yet at the
 * moment the reader is looking at — the same rule `changeSince` follows for a
 * close series, and for the same reason.
 *
 * Null for an instant before the series starts. That is not a gap to paper
 * over: a market that opened this morning genuinely had no price at 3am, and
 * the honest answer to "what was it then" is that there was no it.
 */
export function priceAt(points: PricePoint[], at: number): number | null {
  if (points.length === 0) return null

  // Sorted defensively: the endpoint hands these over in upstream order, and
  // nothing here should depend on that staying true.
  const ordered = [...points].sort((a, b) => Date.parse(a.t) - Date.parse(b.t))

  let found: number | null = null
  for (const p of ordered) {
    if (Date.parse(p.t) <= at) found = p.price
    else break
  }
  return found
}

/** The window the daily move is measured over, matching the upstream's own. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The daily move as it stood at an instant, in percentage points, or null.
 *
 * Recomputed rather than carried over from the live figure. A rewound panel
 * showing a price from six hours ago beside a change measured to right now
 * would be two numbers that cannot both be true — precisely what scene time
 * exists to prevent, and the sort of contradiction that is invisible because
 * both halves render perfectly.
 *
 * Null when the series does not reach a full day before the instant. An
 * incomplete window would answer a different question than the column asks,
 * quietly.
 */
export function changePointsAt(points: PricePoint[], at: number): number | null {
  const now = priceAt(points, at)
  const then = priceAt(points, at - DAY_MS)
  if (now === null || then === null) return null
  return (now - then) * 100
}
