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
