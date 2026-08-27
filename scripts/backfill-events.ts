/**
 * Group the articles already in the database into events.
 *
 * Matching happens at analysis time, so without this every stored row keeps a
 * null event and the source counts have nothing to count until a week of fresh
 * news has come through. Replaying the existing rows in publication order
 * reaches the same assignment the live path would have reached, because the
 * matcher only ever looks backwards.
 *
 * --dry-run prints the grouping and writes nothing. Run it first: this is the
 * only look at what the rules do to a whole corpus before they start doing it
 * to live rows.
 *
 *   cd server && npx tsx ../scripts/backfill-events.ts --dry-run
 *   cd server && npx tsx ../scripts/backfill-events.ts
 */

import Database from 'better-sqlite3'
import { resolveDbPath } from '../server/src/config/paths'
import { findEvent, CORPUS_HOURS } from '../server/src/services/eventMatcher'
import type { Article } from '../server/src/types'

const dryRun = process.argv.includes('--dry-run')
const db = new Database(resolveDbPath(), { readonly: dryRun })

const rows = db
  .prepare(
    `SELECT * FROM articles WHERE is_analyzed = 1 AND title IS NOT NULL
     ORDER BY published_at ASC`,
  )
  .all() as Article[]

console.log(`${rows.length} analysed articles · ${dryRun ? 'dry run' : 'writing'}\n`)

const hoursApart = (a: string | null, b: string | null): number => {
  if (!a || !b) return Infinity
  const ta = Date.parse(a.replace(' ', 'T'))
  const tb = Date.parse(b.replace(' ', 'T'))
  return Number.isNaN(ta) || Number.isNaN(tb) ? Infinity : Math.abs(ta - tb) / 3_600_000
}

/** Assigned as we go, so each article sees exactly what the live path would. */
const assigned: Article[] = []
const events = new Map<string, Article[]>()

for (const row of rows) {
  // The live path hands the matcher a week of news; the replay does the same,
  // measured from the article's own timestamp rather than from now.
  const corpus = assigned.filter((a) => hoursApart(a.published_at, row.published_at) <= CORPUS_HOURS)
  const found = findEvent(row, corpus)
  const eventId = found ?? row.id

  const withEvent = { ...row, event_id: eventId }
  assigned.push(withEvent)

  const members = events.get(eventId)
  if (members) members.push(withEvent)
  else events.set(eventId, [withEvent])
}

const multi = [...events.values()].filter((e) => e.length > 1).sort((a, b) => b.length - a.length)
const sizes = new Map<number, number>()
for (const e of events.values()) sizes.set(e.length, (sizes.get(e.length) ?? 0) + 1)

console.log(`${rows.length} articles → ${events.size} events (${(100 * (1 - events.size / rows.length)).toFixed(1)}% fewer)`)
console.log('sizes:', [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join('  '))
console.log(`multi-article events: ${multi.length}, covering ${multi.reduce((n, e) => n + e.length, 0)} articles\n`)

for (const event of multi) {
  const outlets = new Set(event.map((a) => a.source))
  console.log(`  ${event.length} articles · ${outlets.size} outlets · ${event[0].category}`)
  for (const a of event) {
    console.log(`     ${a.source.slice(0, 11).padEnd(11)} ${(a.intensity ?? '').padEnd(8)} ${(a.title_zh || a.title).slice(0, 44)}`)
  }
  console.log('')
}

if (!dryRun) {
  const update = db.prepare('UPDATE articles SET event_id = ? WHERE id = ?')
  const write = db.transaction((list: Article[]) => {
    for (const a of list) update.run(a.event_id, a.id)
  })
  write(assigned)
  console.log(`Wrote event_id on ${assigned.length} rows.`)
} else {
  console.log('Dry run — nothing written.')
}

db.close()
