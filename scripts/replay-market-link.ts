/**
 * Offline replay for the `market_link` field.
 *
 * Answers the two questions the task board asks before any of this reaches a
 * panel: how often the model invents a link that is not there, and whether
 * asking for the field at all damages the classification that has been working
 * for months.
 *
 * The second question is why every article is run twice, against the prompt as
 * it stands and against the same prompt with the market_link block cut out. A
 * small model is not deterministic, so comparing new output against what the
 * database already holds would measure ordinary run-to-run variance and blame
 * it on this change. Comparing the two prompts on the same article, in the same
 * session, isolates the thing actually being tested.
 *
 * Reads the database; never writes to it.
 *
 *   cd server && npx tsx ../scripts/replay-market-link.ts 200
 *   cd server && npx tsx ../scripts/replay-market-link.ts 40 --no-ab
 */

import Database from 'better-sqlite3'
import { Ollama } from 'ollama'
import { SYSTEM_PROMPT, validateClassification } from '../server/src/services/ollama'
import { resolveDbPath } from '../server/src/config/paths'

/**
 * The prompt as it stood before this change, derived by surgery rather than
 * copied, so the two can never drift apart. Asserted so a future edit that
 * moves the block fails here instead of quietly comparing a prompt to itself.
 */
function baselinePrompt(): string {
  const start = SYSTEM_PROMPT.indexOf('  "market_link":')
  if (start === -1) throw new Error('market_link block not found — update the surgery')
  const out = SYSTEM_PROMPT.slice(0, start).replace(/,\s*$/, '\n') + '}'
  if (out.includes('market_link')) throw new Error('surgery left market_link behind')
  return out
}

interface Row {
  id: string
  title: string
  content: string | null
  category: string | null
}

function loadArticles(limit: number, category?: string): Row[] {
  const db = new Database(resolveDbPath(), { readonly: true })
  try {
    // Narrowing to one stored category turns the harness into a check on a
    // deliberate boundary change: run the articles the old prompt put in a
    // bucket, and see which the new one takes out. A/B cannot answer that,
    // because the baseline is derived by removing only the market_link block
    // and would carry any category wording on both sides.
    if (category) {
      return db.prepare(
        `SELECT id, title, content, category FROM articles
         WHERE is_analyzed = 1 AND title IS NOT NULL AND category = ?
         ORDER BY id LIMIT ?`,
      ).all(category, limit) as Row[]
    }
    // Ordered by id — a content hash, so stable — rather than by recency. The
    // first two runs were ordered by fetched_at and the scraper kept working
    // between them, so they sampled overlapping but different articles and
    // their link rates could not be compared. Retention still deletes expired
    // rows underneath this, but within a session the set holds still.
    return db.prepare(
      `SELECT id, title, content, category FROM articles
       WHERE is_analyzed = 1 AND title IS NOT NULL
       ORDER BY id LIMIT ?`,
    ).all(limit) as Row[]
  } finally {
    db.close()
  }
}

const client = new Ollama({ host: process.env.OLLAMA_HOST ?? 'http://localhost:11434' })
const MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:e4b'

async function classify(system: string, r: Row) {
  const res = await client.chat({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Classify the following news article:\n\nTitle: ${r.title}\n\n` +
                 `Content: ${(r.content ?? '').slice(0, 800)}\n\nRespond with JSON only.`,
      },
    ],
    format: 'json',
    options: { temperature: 0.1, num_ctx: 2048 },
  })
  return validateClassification(JSON.parse(res.message.content))
}

async function main() {
  const limit = Number(process.argv[2] ?? 200)
  const ab = !process.argv.includes('--no-ab')

  /**
   * Control mode: compare the new prompt against *itself*.
   *
   * The A/B figure alone cannot be read. A small model is not deterministic
   * even at a low temperature, so some share of the category disagreement
   * between the two prompts is ordinary run-to-run noise rather than a cost of
   * the new field — and without knowing that share, a 93% agreement could mean
   * either "the field is free" or "the field breaks one article in fourteen".
   * Running the same prompt twice measures the noise floor the A/B number has
   * to be judged against.
   */
  const control = process.argv.includes('--control')
  const categoryArg = process.argv.find((a) => a.startsWith('--category='))?.split('=')[1]

  const rows = loadArticles(limit, categoryArg)
  const baseline = control ? SYSTEM_PROMPT : baselinePrompt()

  const mode = control ? 'control (same prompt twice)' : ab ? 'A/B' : 'single pass'
  console.log(`${rows.length} articles · model ${MODEL} · ${mode}\n`)

  const linked: Array<{ title: string; category: string; link: string }> = []
  let withLink = 0, parseFailures = 0, categoryAgree = 0, categoryCompared = 0
  let intensityAgree = 0

  /**
   * Which category became which, when the two prompts disagreed.
   *
   * The agreement percentage alone cannot say whether the disagreement matters.
   * POLITICAL becoming ECONOMIC on a sanctions story is a coin-flip between two
   * defensible labels; ARMED_CONFLICT becoming SOCIAL is a marker landing in the
   * wrong place on the globe with the wrong colour. Same number, opposite
   * conclusions, so the pairs are counted rather than just the total.
   */
  const flips = new Map<string, { n: number; example: string }>()
  const moved = new Map<string, { n: number; examples: string[] }>()
  let stayed = 0
  const byCommodity = new Map<string, number>()
  const started = Date.now()

  for (const [i, r] of rows.entries()) {
    try {
      const withField = await classify(SYSTEM_PROMPT, r)

      if (ab) {
        const without = await classify(baseline, r)
        categoryCompared++
        if (without.category === withField.category) {
          categoryAgree++
        } else {
          const key = `${without.category} → ${withField.category}`
          const hit = flips.get(key) ?? { n: 0, example: r.title.slice(0, 58) }
          hit.n++
          flips.set(key, hit)
        }
        if (without.intensity === withField.intensity) intensityAgree++
      }

      if (r.category) {
        if (withField.category === r.category) {
          stayed++
        } else {
          const key = `${r.category} → ${withField.category}`
          const hit = moved.get(key) ?? { n: 0, examples: [] }
          hit.n++
          if (hit.examples.length < 6) hit.examples.push(r.title.slice(0, 66))
          moved.set(key, hit)
        }
      }

      if (withField.market_link) {
        withLink++
        const link = withField.market_link
        for (const c of link) byCommodity.set(c, (byCommodity.get(c) ?? 0) + 1)
        linked.push({
          title:    r.title.slice(0, 74),
          category: withField.category,
          link:     link.join('+'),
        })
      }
    } catch (err) {
      parseFailures++
      console.error(`  ! ${r.title.slice(0, 60)} — ${(err as Error).message}`)
    }

    if ((i + 1) % 20 === 0) {
      const rate = (Date.now() - started) / (i + 1) / 1000
      console.error(`  …${i + 1}/${rows.length}  ${rate.toFixed(1)}s/article`)
    }
  }

  // Every link is a candidate false positive, so they are all printed: the rate
  // the task asks for cannot be computed, only judged, and this is the list to
  // judge it from.
  console.log('\n── Linked articles (review each) ──────────────────────────────')
  for (const l of linked) {
    console.log(`${l.link.padEnd(22)} ${l.category.padEnd(15)} ${l.title}`)
  }
  if (linked.length === 0) console.log('(none)')

  const pct = (n: number, d: number) => d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`

  console.log('\n── Summary ───────────────────────────────────────────────────')
  console.log(`articles          ${rows.length}`)
  console.log(`linked            ${withLink}  (${pct(withLink, rows.length)})`)
  console.log(`parse failures    ${parseFailures}`)
  console.log(`commodities       ${[...byCommodity].map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`)
  if (categoryArg) {
    const total = stayed + [...moved.values()].reduce((a, m) => a + m.n, 0)
    console.log(`kept ${categoryArg}    ${stayed}/${total} (${pct(stayed, total)})`)
    console.log('')
    console.log('── Moved out of the stored category ───────────────────')
    for (const [pair, { n, examples }] of [...moved].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`${String(n).padStart(3)} × ${pair}`)
      for (const e of examples) console.log(`      ${e}`)
    }
    if (moved.size === 0) console.log('(none moved)')
  }
  if (ab) {
    console.log(`category agreement ${categoryAgree}/${categoryCompared} (${pct(categoryAgree, categoryCompared)})`)
    console.log(`intensity agreement ${intensityAgree}/${categoryCompared} (${pct(intensityAgree, categoryCompared)})`)
    console.log(control
      ? '  ^ same prompt twice — this is the noise floor, not a cost of anything'
      : '  ^ two prompts on the same article — judge against the --control run, not against 100%')

    if (flips.size > 0) {
      console.log('')
      console.log('── Category flips (what actually changed) ────────────────────')
      for (const [pair, { n, example }] of [...flips].sort((a, b) => b[1].n - a[1].n)) {
        console.log(`${String(n).padStart(3)} × ${pair.padEnd(34)} e.g. ${example}`)
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
