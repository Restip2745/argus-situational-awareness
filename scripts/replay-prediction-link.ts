/**
 * Offline replay for per-event prediction linkage — the measurement that got
 * Stage 3 abandoned.
 *
 * Kept for the reason `replay-market-link.ts` is kept: it is the evidence. The
 * idea of putting a prediction market beside a single news story is an obvious
 * one and will be proposed again, so the two rules that were tried and what
 * they actually produced live here rather than in a commit message.
 *
 * Both rules are deterministic — no model, no text similarity between question
 * and headline — because a free-text match is what the whole feature is shaped
 * to avoid. Every term is a closed enum or a list a person wrote down.
 *
 *   A. country ∩ country, plus the same category.
 *   B. the market's resolution entity appearing among the event's actors, plus
 *      the same category. This is the rule the roadmap named.
 *
 * Neither carries information. Measured over the 200 most recent classified
 * articles:
 *
 *   A. fired on 21.5%, and 19 of those articles drew four markets each. That
 *      is not a link, it is the list of markets about that country — which the
 *      region panel already gives, and gives without attaching it to a headline
 *      it has nothing to do with. "Syria's president makes first Visa payment
 *      after sanctions removal" drew impeachment, the Panama Canal, a US–China
 *      trade agreement and the annexation of Canada.
 *
 *   B. fired on 5.5% and failed more quietly, which is worse. The entity is
 *      named in the story and the market resolves on something else about it.
 *      "Trump 'not in a hurry' over Iran" drew the impeachment market; "SpaceX
 *      launches Starlink satellites" drew a Mars landing; a strike in Gaza drew
 *      Israeli–Saudi normalisation. Each is about the right subject and the
 *      wrong question.
 *
 * The failure is the same in both: co-occurrence is not aboutness. Deciding
 * whether a story bears on a market means reading it against that market's
 * resolution criteria, which is a judgement over free text — the one thing this
 * feature does not do. So there is no Stage 3 in the product.
 *
 * Reads the database; never writes to it.
 *
 *   cd server && npx tsx ../scripts/replay-prediction-link.ts 200
 *   cd server && npx tsx ../scripts/replay-prediction-link.ts 200 --rule=b
 *   cd server && npx tsx ../scripts/replay-prediction-link.ts 469 --all
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { resolveCountryName } from '../client/src/data/countryData'
import { KALSHI_WATCHLIST } from '../server/src/config/predictionMarkets'

const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 200)
const showAll = process.argv.includes('--all')
const rule: 'a' | 'b' = process.argv.includes('--rule=b') ? 'b' : 'a'

/**
 * The entity each watched market resolves on, for rule B, where it has one.
 *
 * Written out generously — every form the local model plausibly emits — so that
 * a miss is the rule failing rather than this table failing. Note how many
 * markets have no entry at all: "Recession in 2027?" and "China overtakes USA's
 * economy" resolve on conditions, not on anyone's actions, and there is nothing
 * for an actor list to match. That alone bounds how much of the watchlist rule
 * B could ever reach.
 */
const ENTITIES: Record<string, string[]> = {
  'KXIMPEACH-29':      ['trump', 'donald trump', 'president trump'],
  'KXCANAL-29':        ['panama canal', 'panama'],
  'KXCANTERRITORY-29': ['canada'],
  'KXABRAHAMSA-29':    ['israel', 'saudi arabia'],
  'KXABRAHAMSY-29':    ['israel', 'syria'],
  'NYTOAI-27DEC31':    ['openai', 'new york times', 'the new york times'],
  'KXSPACEXMARS-30':   ['spacex'],
  'KXBLUESPACEX-30':   ['spacex', 'blue origin'],
  'KXFTAPRC-29':       [],   // an agreement between two states; no entity
  'KXRECSSNBER-27':    [],   // a condition; no entity
  'CHINAUSGDP':        [],   // a condition; no entity
}

interface Row {
  title:          string
  category:       string
  actors:         string | null
  location_label: string | null
}

const db = new Database(join(__dirname, '../data/intelligence.db'), { readonly: true })
const rows = db.prepare(`
  SELECT title, category, actors, location_label
  FROM articles
  WHERE category IS NOT NULL
  ORDER BY published_at DESC
  LIMIT ?
`).all(limit) as Row[]

const parseActors = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

/**
 * The countries an event is about, via the resolver the region panel uses.
 *
 * Both the label and the actors: a story datelined Washington about
 * Israeli–Saudi talks resolves to one country from its label and to the others
 * only from its actors.
 */
function countriesOf(row: Row, actors: string[]): string[] {
  const out = new Set<string>()
  const label = row.location_label ? resolveCountryName(row.location_label) : null
  if (label) out.add(label)
  for (const a of actors) {
    const r = resolveCountryName(a)
    if (r) out.add(r)
  }
  return [...out]
}

function linksFor(row: Row, actors: string[]): string[] {
  if (rule === 'a') {
    const countries = countriesOf(row, actors)
    if (countries.length === 0) return []
    return KALSHI_WATCHLIST
      .filter((m) => m.category === row.category
                  && (m.countries ?? []).some((c) => countries.includes(c)))
      .map((m) => m.id)
  }
  const lowered = actors.map((a) => a.toLowerCase().trim())
  return KALSHI_WATCHLIST
    .filter((m) => m.category === row.category
                && (ENTITIES[m.id] ?? []).some((n) => lowered.includes(n)))
    .map((m) => m.id)
}

let linked = 0
let withCountry = 0
const perMarket = new Map<string, number>()
const perCount = new Map<number, number>()
const samples: string[] = []

for (const row of rows) {
  const actors = parseActors(row.actors)
  if (countriesOf(row, actors).length > 0) withCountry++

  const hits = linksFor(row, actors)
  perCount.set(hits.length, (perCount.get(hits.length) ?? 0) + 1)
  if (hits.length === 0) continue

  linked++
  for (const id of hits) perMarket.set(id, (perMarket.get(id) ?? 0) + 1)
  if (showAll || samples.length < 25) {
    samples.push(
      `  [${row.category}] ${row.title.slice(0, 68)}\n` +
      `      links: ${hits.join(', ')}`)
  }
}

const pct = (n: number, of: number) => of === 0 ? '0%' : `${((n / of) * 100).toFixed(1)}%`

console.log(`rule:                 ${rule === 'a' ? 'A (country ∩ country + category)' : 'B (entity ∈ actors + category)'}`)
console.log(`articles:             ${rows.length}`)
console.log(`resolve to a country: ${withCountry} (${pct(withCountry, rows.length)})`)
console.log(`link to a market:     ${linked} (${pct(linked, rows.length)})`)

console.log('\nlinks per article:')
for (const [n, c] of [...perCount.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${n} market(s): ${c} article(s)`)
}

console.log('\nhow often each market is drawn:')
for (const [id, c] of [...perMarket.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(20)} ${c}`)
}

console.log(`\nsample${showAll ? '' : ' (first 25)'} — read these, not the percentages:`)
console.log(samples.join('\n') || '  (nothing)')
