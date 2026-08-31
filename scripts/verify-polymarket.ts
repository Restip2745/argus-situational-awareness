/**
 * Check the Polymarket watchlist and the assumptions the parser makes about it.
 *
 * Everything in `services/prediction/polymarket.ts` and in
 * `POLYMARKET_WATCHLIST` was written without reaching the source: the domain is
 * DNS-blocked in Taiwan and in other jurisdictions that treat it as gambling.
 * The slugs are guesses and the field shapes are assumed. This turns checking
 * all of that into one command for whoever is on a network that resolves it.
 *
 * Three questions, which are the three unverified things:
 *
 *   1. Which slugs still exist? A hand-maintained list drifts behind markets
 *      that have resolved, and these never had a first version that was right.
 *   2. Does `parseMarket` survive the real payload? It is run here against
 *      whatever comes back, and its refusals are reported with the reason —
 *      a refusal is not necessarily wrong, but "refused every single one" means
 *      the shape assumptions are off rather than the markets being unsuitable.
 *   3. What volume do real markets carry? `MIN_VOLUME_USD` is a placeholder;
 *      the distribution printed at the end is what it should be set from.
 *
 * Writes nothing. Touches no database.
 *
 *   cd server && npx tsx ../scripts/verify-polymarket.ts
 */

import { POLYMARKET_WATCHLIST } from '../server/src/config/predictionMarkets'
import { parseMarket, MIN_VOLUME_USD } from '../server/src/services/prediction/polymarket'

const GAMMA = 'https://gamma-api.polymarket.com'

/** The fields `parseMarket` actually reads, for the shape dump. */
const READ_FIELDS = [
  'question', 'outcomes', 'outcomePrices', 'clobTokenIds', 'oneDayPriceChange',
  'volumeNum', 'volume', 'endDate', 'closed', 'active', 'archived', 'events',
]

interface Result {
  slug:   string
  found:  boolean
  parsed: boolean
  note:   string
  volume: number | null
}

/**
 * Why a record that exists was refused.
 *
 * Re-derives the reason rather than having `parseMarket` report it: the parser
 * answers null on purpose — a caller that has to distinguish "settled" from
 * "malformed" has lost the contract — and this is the one place that
 * distinction is worth the duplication.
 */
function refusalReason(rec: Record<string, unknown>): string {
  const arr = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v
    if (typeof v === 'string') { try { const p: unknown = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null } }
    return null
  }
  const num = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string' && v.trim()) { const n = Number(v); return Number.isFinite(n) ? n : null }
    return null
  }

  if (rec.closed === true) return 'closed'
  if (rec.archived === true) return 'archived'
  if (rec.active === false) return 'inactive'
  if (typeof rec.question !== 'string') return 'no question field'

  const outcomes = arr(rec.outcomes)
  const prices = arr(rec.outcomePrices)
  if (!outcomes || !prices) return 'outcomes/outcomePrices not readable as arrays — SHAPE'
  if (outcomes.length !== 2) return `${outcomes.length} outcomes, not binary`
  if (!outcomes.some((o) => typeof o === 'string' && o.trim().toLowerCase() === 'yes')) {
    return `no YES side (outcomes: ${JSON.stringify(outcomes)}) — SHAPE`
  }

  const vol = num(rec.volumeNum) ?? num(rec.volume)
  if (vol === null) return 'volume not readable — SHAPE'
  if (vol < MIN_VOLUME_USD) return `volume ${Math.round(vol)} below floor ${MIN_VOLUME_USD}`

  const end = typeof rec.endDate === 'string' ? Date.parse(rec.endDate) : NaN
  if (!Number.isNaN(end) && end < Date.now()) return 'end date has passed'

  return 'refused for a reason not covered here — look at the raw record'
}

async function main(): Promise<void> {
  console.log(`checking ${POLYMARKET_WATCHLIST.length} slugs against ${GAMMA}\n`)

  const results: Result[] = []
  let shapeDumped = false

  for (const w of POLYMARKET_WATCHLIST) {
    let body: unknown
    try {
      const res = await fetch(`${GAMMA}/markets?slug=${encodeURIComponent(w.id)}&limit=1`, {
        headers: { Accept: 'application/json' },
        signal:  AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        results.push({ slug: w.id, found: false, parsed: false, note: `HTTP ${res.status}`, volume: null })
        continue
      }
      body = await res.json()
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message
      if (String(cause).includes('SELF_SIGNED') || String(cause).includes('CERT')) {
        console.error(
          `\nThe domain is not reachable from here: ${cause}.\n` +
          `That is a DNS block presenting a substitute certificate, not an outage — see the\n` +
          `troubleshooting note in the README. This script has to run somewhere that resolves it.\n`)
        process.exit(1)
      }
      results.push({ slug: w.id, found: false, parsed: false, note: String(cause), volume: null })
      continue
    }

    const rec = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined
    if (!rec) {
      results.push({ slug: w.id, found: false, parsed: false, note: 'empty reply — slug does not exist', volume: null })
      continue
    }

    // The first record that comes back settles the shape questions for all of
    // them, so it is printed in full rather than summarised.
    if (!shapeDumped) {
      shapeDumped = true
      console.log(`── raw record for ${w.id}, fields the parser reads ──`)
      for (const f of READ_FIELDS) {
        const v = rec[f]
        console.log(`  ${f.padEnd(18)} ${typeof v === 'undefined' ? '(absent)' : `${typeof v}: ${JSON.stringify(v).slice(0, 110)}`}`)
      }
      const extra = Object.keys(rec).filter((k) => !READ_FIELDS.includes(k))
      console.log(`  (other keys: ${extra.slice(0, 20).join(', ')}${extra.length > 20 ? ', …' : ''})\n`)
    }

    const market = parseMarket(body, w.id)
    const volRaw = rec.volumeNum ?? rec.volume
    const volume = typeof volRaw === 'number' ? volRaw
                 : typeof volRaw === 'string' ? Number(volRaw) : null

    results.push({
      slug:   w.id,
      found:  true,
      parsed: market !== null,
      note:   market !== null ? `price ${market.price}` : refusalReason(rec),
      volume: Number.isFinite(volume as number) ? volume : null,
    })
  }

  console.log('── per slug ──')
  for (const r of results) {
    const status = !r.found ? 'MISSING' : r.parsed ? 'ok     ' : 'refused'
    console.log(`  ${status}  ${r.slug.padEnd(46)} ${r.note}`)
  }

  const missing = results.filter((r) => !r.found)
  const shapeIssues = results.filter((r) => r.found && !r.parsed && r.note.includes('SHAPE'))
  console.log(`\nfound: ${results.length - missing.length}/${results.length}   parsed: ${results.filter((r) => r.parsed).length}`)
  if (missing.length) {
    console.log(`\nreplace these — read the slug off the last path segment of the market's URL:`)
    for (const r of missing) console.log(`  ${r.slug}`)
  }
  if (shapeIssues.length) {
    console.log(`\nSHAPE assumptions look wrong — fix parseMarket, not the watchlist:`)
    for (const r of shapeIssues) console.log(`  ${r.slug}: ${r.note}`)
  }

  const vols = results.map((r) => r.volume).filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (vols.length) {
    const at = (q: number) => Math.round(vols[Math.floor((vols.length - 1) * q)])
    console.log(`\nvolume across ${vols.length} found market(s), for calibrating MIN_VOLUME_USD (now ${MIN_VOLUME_USD}):`)
    console.log(`  min ${at(0)}   p25 ${at(0.25)}   median ${at(0.5)}   p75 ${at(0.75)}   max ${at(1)}`)
  }
}

void main()
