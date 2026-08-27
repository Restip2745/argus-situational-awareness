/**
 * Why one article did or did not join another's event.
 *
 * Prints the terms each side contributes, which of them survive as evidence,
 * how far apart the two are, and what the bar was — the numbers the matcher
 * decides on and never reports.
 *
 * Worth keeping. Two reports 800 metres apart in Conakry were failing to join,
 * and the reason was not visible from the grouping: the corpus at that moment
 * held 111 articles, which put the two-percent bar at 3, and `Guinea` at four
 * documents was being discarded as generic. That is one line of this output.
 *
 *   cd server && npx tsx ../scripts/debug-match.ts "搜救隊" "垃圾場崩塌致30"
 */
import Database from 'better-sqlite3'
import { resolveDbPath } from '../server/src/config/paths'
import {
  extractTerms, CORPUS_HOURS, GENERIC_SHARE, MIN_SPECIFIC_DOCS,
  EVIDENCE_RATIO, SUBJECT_WEIGHT, isSubjectTerm, kmApart,
} from '../server/src/services/eventMatcher'
import type { Article } from '../server/src/types'

const [needleA, needleB] = process.argv.slice(2)
const db = new Database(resolveDbPath(), { readonly: true })
const all = db.prepare('SELECT * FROM articles WHERE is_analyzed = 1').all() as Article[]
db.close()

const find = (n: string) => all.find((a) => (a.title_zh ?? '').includes(n) || a.title.includes(n))
const a = find(needleA)!
const b = find(needleB)!
console.log(`A: ${a.title_zh} [${a.location_label} ${a.lat},${a.lng}] ${a.published_at}`)
console.log(`B: ${b.title_zh} [${b.location_label} ${b.lat},${b.lng}] ${b.published_at}\n`)

const hours = (x: string | null, y: string | null) =>
  !x || !y ? Infinity : Math.abs(Date.parse(x.replace(' ', 'T')) - Date.parse(y.replace(' ', 'T'))) / 3_600_000

// The corpus A would have seen: everything published before it, inside the week.
const corpus = all.filter((r) =>
  r.published_at && a.published_at &&
  r.published_at <= a.published_at && hours(r.published_at, a.published_at) <= CORPUS_HOURS)
console.log(`corpus at A's moment: ${corpus.length} articles`)

const terms = new Map<string, Set<string>>()
for (const r of corpus) {
  for (const t of extractTerms(r)) {
    let s = terms.get(t); if (!s) terms.set(t, (s = new Set()))
    s.add(r.source)
  }
}
const dfOf = (t: string) => corpus.filter((r) => extractTerms(r).has(t)).length
const shared = [...extractTerms(a)].filter((t) => extractTerms(b).has(t))
const specificAt = Math.max(MIN_SPECIFIC_DOCS, corpus.length * GENERIC_SHARE)
const bar = EVIDENCE_RATIO * Math.log(corpus.length)
const km = kmApart(a, b)
console.log(`${km === null ? 'no coordinates on one side' : km.toFixed(0) + 'km apart'}`)

console.log(`specific if df <= ${specificAt.toFixed(1)} · evidence bar ${bar.toFixed(2)}\n`)
console.log('shared terms:')
for (const t of shared) {
  const df = dfOf(t)
  const outlets = terms.get(t)?.size ?? 0
  const idf = Math.log(corpus.length / Math.max(df, 1)) * (isSubjectTerm(t) ? SUBJECT_WEIGHT : 1)
  const ok = df <= specificAt && outlets > 1
  console.log(`  ${t.padEnd(24)} df=${String(df).padStart(3)} outlets=${outlets} idf=${idf.toFixed(2)}` +
    `${isSubjectTerm(t) ? ' (subject)' : ''} ${ok ? 'EVIDENCE' : 'discarded'}`)
}
