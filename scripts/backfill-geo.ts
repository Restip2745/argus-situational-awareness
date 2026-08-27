/**
 * Re-resolve coordinates for every analysed article already in the database.
 *
 * Coordinate resolution used to happen in the client, per render, so nothing
 * was ever written back: half the geo rows still hold a usable location label
 * next to a null lat/lng. This walks the table through the same gazetteer the
 * classifier now uses and fills in what it can.
 *
 * Rows the model gave real coordinates for are left alone — the point is to
 * rescue the ones it did not, not to second-guess the ones it did.
 *
 *   cd server && npx tsx ../scripts/backfill-geo.ts --dry-run
 *   cd server && npx tsx ../scripts/backfill-geo.ts
 *
 * --dry-run prints the before/after breakdown and writes nothing.
 */

import Database from 'better-sqlite3'
import { resolveLocation, type GeoPrecision } from '../server/src/data/gazetteer'
import { resolveDbPath } from '../server/src/config/paths'

const dryRun = process.argv.includes('--dry-run')
const dbPath = resolveDbPath()

const db = new Database(dbPath, { readonly: dryRun })

// The column may not exist yet if the server has not started since the
// migration landed; adding it here keeps the script runnable on its own.
const cols = db.prepare('PRAGMA table_info(articles)').all() as { name: string }[]
if (!cols.some(c => c.name === 'geo_precision')) {
  if (dryRun) {
    console.log('note: geo_precision column missing — start the server once, or drop --dry-run\n')
  } else {
    db.exec('ALTER TABLE articles ADD COLUMN geo_precision TEXT')
    console.log('added geo_precision column\n')
  }
}

interface Row {
  id: string
  location_type: string | null
  location_label: string | null
  lat: number | null
  lng: number | null
}

const rows = db.prepare(
  `SELECT id, location_type, location_label, lat, lng
     FROM articles
    WHERE is_analyzed = 1 AND location_type = 'geo'`
).all() as Row[]

const update = dryRun ? null : db.prepare(
  'UPDATE articles SET lat = ?, lng = ?, geo_precision = ? WHERE id = ?'
)

const before = { placed: 0, unplaced: 0 }
const after: Record<GeoPrecision, number> = { exact: 0, centroid: 0, region: 0, none: 0 }
const rescued: Record<string, number> = {}
const stillNone: Record<string, number> = {}
let changed = 0

const apply = db.transaction((batch: Row[]) => {
  for (const row of batch) {
    const had = row.lat !== null && row.lng !== null
    had ? before.placed++ : before.unplaced++

    const geo = resolveLocation(row.location_label, row.lat, row.lng)
    after[geo.precision]++

    if (!had && geo.lat !== null) {
      const label = row.location_label || '(empty)'
      rescued[`${label} → ${geo.key}`] = (rescued[`${label} → ${geo.key}`] ?? 0) + 1
    }
    if (geo.precision === 'none') {
      const label = row.location_label || '(empty)'
      stillNone[label] = (stillNone[label] ?? 0) + 1
    }

    if (geo.lat !== row.lat || geo.lng !== row.lng) changed++
    update?.run(geo.lat, geo.lng, geo.precision, row.id)
  }
})

apply(rows)

// ── Report ──────────────────────────────────────────────

const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`
const placedAfter = after.exact + after.centroid

console.log(`${dryRun ? '[dry run] ' : ''}analysed geo articles: ${rows.length}\n`)
console.log('before')
console.log(`  placed        ${String(before.placed).padStart(4)}  ${pct(before.placed)}`)
console.log(`  no coordinates${String(before.unplaced).padStart(4)}  ${pct(before.unplaced)}\n`)
console.log('after')
console.log(`  exact         ${String(after.exact).padStart(4)}  ${pct(after.exact)}   model-supplied point`)
console.log(`  centroid      ${String(after.centroid).padStart(4)}  ${pct(after.centroid)}   resolved from label`)
console.log(`  region        ${String(after.region).padStart(4)}  ${pct(after.region)}   real area, no single point`)
console.log(`  none          ${String(after.none).padStart(4)}  ${pct(after.none)}   unresolvable`)
console.log(`  ── placed     ${String(placedAfter).padStart(4)}  ${pct(placedAfter)}\n`)

const rescuedList = Object.entries(rescued).sort((a, b) => b[1] - a[1])
if (rescuedList.length) {
  console.log(`rescued by the gazetteer (${rescuedList.reduce((s, [, n]) => s + n, 0)} rows, top 25)`)
  for (const [label, n] of rescuedList.slice(0, 25)) {
    console.log(`  ${String(n).padStart(3)}  ${label}`)
  }
  console.log()
}

const noneList = Object.entries(stillNone).sort((a, b) => b[1] - a[1])
if (noneList.length) {
  console.log(`still unresolvable (${noneList.reduce((s, [, n]) => s + n, 0)} rows) — candidates for the table`)
  for (const [label, n] of noneList.slice(0, 25)) {
    console.log(`  ${String(n).padStart(3)}  ${label}`)
  }
  console.log()
}

console.log(dryRun ? `would update ${changed} row(s) — rerun without --dry-run` : `updated ${changed} row(s)`)
db.close()
