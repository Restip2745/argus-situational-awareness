/**
 * Would a model decide per-event linkage better than the rules did?
 *
 * It would. That is not the reason there is still no linkage in the product,
 * and this file exists so the next person does not re-derive the wrong lesson
 * from `replay-prediction-link.ts` next door.
 *
 * The refusal that shaped this feature was about picking a market out of an
 * open-ended space, where an id can be invented and a wrong pick renders as an
 * ordinary percentage. A curated watchlist changes the shape of the question:
 * the candidates are supplied, so this is closed multiple-choice with an
 * abstain, and every answer is checked against the list it came from — the same
 * shape `market_link` has, and that one shipped. The other thing the rules
 * could not have is `rules_primary`, the settlement text. Rule C failed because
 * "sovereignty" means one thing in a trade story and another in an annexation
 * market; judging a story against the criteria is a well-posed reading task.
 *
 * ── What was measured, on gemma4:e4b ─────────────────────────────────────────
 *
 * **On a set built out of traps** — the cases that broke the rules — it made
 * exactly one link, and the right one: "Trump says Canada wants 'benefits' of
 * being US state" to the annexation market. It refused the Panama Canal story
 * that was about shipping, the SpaceX launch that was not a Mars landing, the
 * Saudi story that was not about Israel, and the sovereignty story that fooled
 * rule C. No invented ids. Run with and without the line telling it that
 * abstaining is normal, it gave the same answer both times, so the abstentions
 * are judgement rather than an instruction being obeyed.
 *
 * **On 200 recent articles it linked nothing at all** — 0 across all nine
 * categories. That is not the model failing. The rules put the base rate at
 * roughly 2 links in 469 articles, so a sample of 200 is expected to contain
 * about one, and a sample that small cannot measure a half-percent phenomenon.
 *
 * ── Why there is still no feature ────────────────────────────────────────────
 *
 * The constraint is the watchlist, not the method. Eleven markets can only ever
 * be about eleven things, so almost nothing links, and at ~5.4s of local
 * inference per article this spends about eighteen minutes per two hundred
 * articles to produce zero rows.
 *
 * Which inverts the tension the roadmap originally recorded. The thought was
 * that a large market inventory would need a matcher and a matcher was what we
 * refused. The measurement says the matcher works and the small list is what
 * starves it. A Stage 3 worth building would go the other way round: pull a
 * wide candidate set from the exchange for the event's country and category,
 * and let the model judge those against their settlement criteria — one call
 * per event rather than eleven per article. That is a redesign, not a fix.
 *
 * Reads the database; never writes to it. Needs Ollama.
 *
 *   cd server && npx tsx ../scripts/replay-llm-link.ts 200
 *   cd server && npx tsx ../scripts/replay-llm-link.ts --positives
 *   cd server && npx tsx ../scripts/replay-llm-link.ts --positives --loose
 *   cd server && npx tsx ../scripts/replay-llm-link.ts 200 --model=gemma4:12b
 */
import Database from 'better-sqlite3'
import { Ollama } from 'ollama'
import { join } from 'path'
import { KALSHI_WATCHLIST } from '../server/src/config/predictionMarkets'

const N = Number(process.argv[2] ?? 60)
const MODEL = process.argv.find((a) => a.startsWith('--model='))?.slice(8) ?? 'gemma4:e4b'
const API = 'https://api.elections.kalshi.com/trade-api/v2'

interface Candidate { id: string; question: string; rules: string }

/** Question and settlement text for each watched market, read live. */
async function candidates(): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const w of KALSHI_WATCHLIST) {
    const r = await fetch(`${API}/events/${encodeURIComponent(w.id)}?with_nested_markets=true`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    if (!r.ok) continue
    const body = await r.json() as { event?: any }
    const e = body.event ?? body
    const m = (e.markets ?? [])[0]
    if (!m) continue
    out.push({
      id: w.id,
      question: `${e.title}${e.sub_title ? ` — ${e.sub_title}` : ''}`,
      rules: String(m.rules_primary ?? '').slice(0, 300),
    })
  }
  return out
}

function prompt(list: Candidate[]): string {
  return `You decide whether a news article bears on any of a fixed list of prediction markets.

A market is listed with its question and the criteria it settles on. An article bears on a market only if it changes, or is direct evidence about, whether those criteria will be met. Mentioning the same country, the same person, or the same general topic is NOT enough.

${process.argv.includes('--loose') ? '' : `Most articles bear on none of them. Answering with an empty list is the normal, expected answer.
`}
MARKETS:
${list.map((c) => `- id: ${c.id}\n  question: ${c.question}\n  settles on: ${c.rules}`).join('\n')}

Reply with JSON only: {"links": ["<id>", ...]}
Use ids exactly as written above. Empty list if none apply.`
}

interface Row { id: string; title: string; content: string | null; category: string }

async function main(): Promise<void> {
  const list = await candidates()
  console.log(`model: ${MODEL} | candidates: ${list.length}\n`)

  const db = new Database(join(__dirname, '../data/intelligence.db'), { readonly: true })
  // With `--positives`, the sample is chosen to contain articles that should
  // link and, more importantly, traps that should not: a Panama Canal story
  // that is about shipping rather than annexation, a SpaceX launch that is not
  // a Mars landing, a Saudi story that is not about Israel. A run over recent
  // articles alone cannot tell a careful abstain from an inability to answer.
  const PATTERNS = ['impeach', 'recession', 'tariff', 'trade deal', 'Panama Canal',
                    'annex', 'Starship', 'SpaceX', 'Blue Origin', 'OpenAI', 'normaliz', 'Saudi']
  const rows = process.argv.includes('--positives')
    ? (() => {
        const seen = new Map<string, Row>()
        for (const pat of PATTERNS) {
          const got = db.prepare(
            `SELECT id, title, content, category FROM articles
             WHERE category IS NOT NULL AND content IS NOT NULL
               AND (title LIKE ? OR content LIKE ?) LIMIT 3`).all(`%${pat}%`, `%${pat}%`) as Row[]
          for (const r of got) if (!seen.has(r.id)) seen.set(r.id, r)
        }
        return [...seen.values()]
      })()
    : db.prepare(
        `SELECT id, title, content, category FROM articles
         WHERE category IS NOT NULL AND content IS NOT NULL
         ORDER BY published_at DESC LIMIT ?`).all(N) as Row[]

  const ollama = new Ollama({ host: 'http://localhost:11434' })
  const ids = new Set(list.map((c) => c.id))
  const system = prompt(list)

  let linked = 0, invalid = 0, unparsed = 0
  const perMarket = new Map<string, number>()
  const perCount = new Map<number, number>()
  const perCategory = new Map<string, { seen: number; linked: number }>()
  const samples: string[] = []
  const started = Date.now()

  for (const [i, row] of rows.entries()) {
    const user = `TITLE: ${row.title}\nCATEGORY: ${row.category}\nCONTENT: ${(row.content ?? '').slice(0, 700)}`
    let hits: string[] = []
    try {
      const res = await ollama.chat({
        model: MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        format: 'json',
        options: { temperature: 0.1, num_ctx: 4096 },
      })
      const parsed = JSON.parse(res.message.content) as { links?: unknown }
      const raw = Array.isArray(parsed.links) ? parsed.links : []
      const strings = raw.filter((x): x is string => typeof x === 'string')
      // Validated against the list it was given, the way categories are.
      hits = strings.filter((s) => ids.has(s))
      invalid += strings.length - hits.length
    } catch {
      unparsed++
      continue
    }

    perCount.set(hits.length, (perCount.get(hits.length) ?? 0) + 1)
    const cat = perCategory.get(row.category) ?? { seen: 0, linked: 0 }
    cat.seen++
    if (hits.length > 0) cat.linked++
    perCategory.set(row.category, cat)

    if (hits.length === 0) continue
    linked++
    for (const id of hits) perMarket.set(id, (perMarket.get(id) ?? 0) + 1)
    samples.push(`  [${row.category}] ${row.title.slice(0, 68)}\n      → ${hits.join(', ')}`)
    if ((i + 1) % 20 === 0) process.stderr.write(`  …${i + 1}/${rows.length}\n`)
  }

  const secs = Number(((Date.now() - started) / 1000).toFixed(0))
  console.log(`articles:            ${rows.length}   (${secs}s, ${(secs / rows.length).toFixed(1)}s each)`)
  console.log(`linked:              ${linked} (${((linked / rows.length) * 100).toFixed(1)}%)`)
  console.log(`unparseable:         ${unparsed}`)
  console.log(`ids not on the list: ${invalid}`)

  // Too eager shows up here: an article drawing several markets is the rule-A
  // failure — the answer being "markets about this country" rather than a link.
  console.log('\nlinks per article:')
  for (const [n, c] of [...perCount.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${n} market(s): ${c}`)
  }

  // Too flat shows up here: one market taking nearly every link means it is not
  // reading the article, it is answering the same way each time.
  console.log('\nper market:')
  for (const [id, c] of [...perMarket.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${id.padEnd(20)} ${c}`)
  const idle = list.filter((c) => !perMarket.has(c.id)).map((c) => c.id)
  console.log(`  (never drawn: ${idle.length ? idle.join(', ') : 'none'})`)

  console.log('\nby category:')
  for (const [cat, v] of [...perCategory.entries()].sort((a, b) => b[1].seen - a[1].seen)) {
    console.log(`  ${cat.padEnd(16)} ${String(v.linked).padStart(3)}/${String(v.seen).padEnd(4)} ${((v.linked / v.seen) * 100).toFixed(0)}%`)
  }

  console.log('\nevery link it made — read these, not the percentages:')
  console.log(samples.join('\n') || '  (nothing)')
}

void main()
