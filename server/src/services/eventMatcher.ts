/**
 * Which stories are the same happening.
 *
 * Seven outlets covered one landfill collapse in Conakry and the globe drew
 * seven markers; the status bar counted twenty CRITICAL events where eleven had
 * occurred. The dashboard counts articles and calls them events, and that only
 * became visible once the intensity rubric let CRITICAL fire at all.
 *
 * Matching is on rare named things, not on similarity. Five Gaza articles about
 * five different attacks read as similar to any embedding because they are all
 * about Gaza; what separates one landfill collapse from a different airstrike
 * is whether both name the same particulars. Terms are weighted by inverse
 * document frequency, so `Israel` and `Trump` — carried by a large share of any
 * week's news — fall out on their own, while `Conakry` and `Carcassonne` name
 * exactly one happening. No vocabulary is maintained by hand.
 *
 * Three corrections, each from a merge that actually happened during the
 * offline work on 453 stored articles:
 *
 *   - `Only`, sliced out of `OnlyFans` by a regex that stopped at the second
 *     capital, joined a hospital fire to a pornography earnings story.
 *   - `Wafaa Shurafa` and `Production`, an agency byline and a credit line,
 *     joined two unrelated AP reports from Gaza. A term no second outlet has
 *     ever used cannot evidence corroboration between outlets, which is the
 *     one thing this module exists to measure.
 *   - `Les États-Unis` joined an Iran sanctions story to a Syrian delisting,
 *     the article surviving because the stop list only rejected `Les` alone.
 *
 * Country names and the demonyms built from them are weighted down rather than
 * struck out: `Syria` alone had held a delisting, a war-crimes verdict and an
 * SDF disbandment together, but `Guinea` alone is the only thing binding the
 * Conakry collapse, and removing countries outright destroys the best merge in
 * the corpus to fix the worst.
 *
 * Everything here fails toward "its own event". A missed match leaves a
 * duplicate marker, which is what the globe already shows today; a wrong match
 * would merge two real events into one. The first is the status quo, the second
 * is a loss, so every guard below resolves the doubt the same way.
 */
import type { Article } from '../types'
import { logger } from '../utils/logger'
import { _internals as gazetteer } from '../data/gazetteer'

/** How much news the rarity of a term is judged against. See GENERIC_SHARE. */
export const CORPUS_HOURS = 168

/** How far back a story may reach to join an event. Coverage of the Conakry
 *  collapse ran 51 hours from first report to the last follow-up, so a day is
 *  not enough; beyond three days the window stops buying recall and starts
 *  collecting unrelated developments in the same long-running situation. */
const WINDOW_HOURS = 72

/**
 * Rarity needed before two stories are held to name the same thing, as a share
 * of the rarest a term could possibly be.
 *
 * Not an absolute number, because inverse document frequency scales with the
 * size of the corpus it is measured over: `log(N/n)`. A threshold tuned on a
 * week of news quietly tightens when the window happens to hold less, and the
 * Conakry collapse split in two the first time this ran on live-shaped data —
 * a Reuters report saying "Guinea's capital" rather than naming Conakry shared
 * only `Guinea`, worth 2.50 against 453 articles and 1.93 against 150. Held as
 * a fraction of `log(N)` the bar means the same thing at any corpus size.
 */
const EVIDENCE_RATIO = 0.4

/**
 * A term this common across the corpus names a subject, not a happening.
 *
 * Measured over a week rather than over the matching window, and the two are
 * deliberately different lengths. Document frequency needs enough news to
 * separate `Israel`, which any week carries dozens of, from `Conakry`, which
 * one disaster carries. Three days does not hold enough for that: at a hundred
 * or so articles the share falls below one document and every term looks rare,
 * which is exactly backwards — it would make everything match everything.
 */
const GENERIC_SHARE = 0.02

/** …and a floor under it, so a corpus too small for the share to mean anything
 *  still admits the terms that only a handful of articles carry. */
const MIN_SPECIFIC_DOCS = 3

/** Countries and demonyms still carry evidence, but less of it. */
const SUBJECT_WEIGHT = 0.6

/** Below this, document frequency means nothing — every term looks rare in a
 *  handful of articles, and everything would match everything. A fresh install
 *  therefore assigns each story its own event until the window fills. */
const MIN_CORPUS = 20

/** A story joins an event when it matches this share of the articles already
 *  in it. Requiring all of them split the Conakry collapse five ways, since a
 *  late rescue report shares little with the first bulletin; requiring only one
 *  chained a delisting, a verdict and a disbandment into a single Syrian
 *  "event" through links that no two of them shared. */
const MAJORITY = 0.5

/**
 * `(?![A-Za-z…])` is the OnlyFans fix: the match must end where the word does,
 * or a capital inside a word ends it early and leaves a fragment behind.
 */
const PROPER_NOUN =
  /\b[A-ZÀ-Ý][a-zà-ÿ]{2,}(?:[ -][A-ZÀ-Ý][a-zà-ÿ]{2,})*(?![A-Za-zÀ-ÿ])/g

/** Articles that capitalise because they lead a phrase, not because they name
 *  anything. Stripped from the front of a multi-word match so `Les États-Unis`
 *  becomes `États-Unis` and is then weighted as the country it is. */
const LEADING_ARTICLES = new Set([
  'Les', 'Des', 'Une', 'Der', 'Die', 'Das', 'The', 'Los', 'Las', 'Del', 'Le', 'La',
])

/** Capitalised because they open a sentence or a headline. */
const STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'And', 'But', 'For', 'With', 'From',
  'After', 'Before', 'What', 'When', 'Where', 'Which', 'Who', 'How', 'Why',
  'Its', 'His', 'Her', 'Their', 'New', 'More', 'Live', 'Video', 'Watch',
  'Analysis', 'Opinion', 'News', 'Update', 'Latest', 'Breaking',
  'Les', 'Des', 'Une', 'Dans', 'Pour', 'Sur', 'Que', 'Qui', 'Avec', 'Apres',
  'Selon', 'Est', 'Son', 'Ses', 'Leur', 'Cette',
])

/** Only the head of the body is read. Later paragraphs drift into background
 *  and boilerplate, which is where the byline problem lived. */
const CONTENT_CHARS = 600

/**
 * Prefixes of the gazetteer's country names, long enough to catch the demonym
 * without swallowing unrelated words. `Iranian` had bound three unrelated Iran
 * stories together and no gazetteer lists demonyms, so they are derived:
 * Iran → Iranian, Syria → Syrian, China → Chinese.
 */
const COUNTRY_PREFIXES: string[] = (() => {
  const names = Object.keys(gazetteer.PLACES)
  const out = new Set<string>()
  for (const n of names) {
    if (n.length >= 4) out.add(n.slice(0, Math.min(5, n.length)).toLowerCase())
  }
  return [...out]
})()

function isSubjectTerm(term: string): boolean {
  const t = term.toLowerCase()
  return COUNTRY_PREFIXES.some((p) => t.startsWith(p))
}

/** The named things an article mentions, before any weighting. */
export function extractTerms(article: Pick<Article, 'title' | 'summary_en' | 'content'>): Set<string> {
  const text = [
    article.title ?? '',
    article.summary_en ?? '',
    (article.content ?? '').slice(0, CONTENT_CHARS),
  ].join(' ')

  const out = new Set<string>()
  for (const match of text.matchAll(PROPER_NOUN)) {
    let term = match[0]
    const words = term.split(' ')
    if (words.length > 1 && LEADING_ARTICLES.has(words[0])) {
      term = words.slice(1).join(' ')
    }
    if (term && !STOPWORDS.has(term)) out.add(term)
  }
  return out
}

interface Scored {
  article: Article
  terms: Set<string>
}

/** Everything the window knows about how common each term is, and who used it. */
interface Corpus {
  size:    number
  /** Absolute evidence bar for this corpus — EVIDENCE_RATIO of log(size). */
  bar:     number
  idf:     Map<string, number>
  /** Terms rare enough, and used by enough outlets, to count as evidence. */
  evidential: Set<string>
}

function buildCorpus(scored: Scored[]): Corpus {
  const docFreq = new Map<string, number>()
  const sources = new Map<string, Set<string>>()

  for (const s of scored) {
    for (const term of s.terms) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
      let seen = sources.get(term)
      if (!seen) sources.set(term, (seen = new Set()))
      seen.add(s.article.source)
    }
  }

  const size = scored.length
  const idf = new Map<string, number>()
  const evidential = new Set<string>()

  for (const [term, n] of docFreq) {
    const weight = Math.log(size / n) * (isSubjectTerm(term) ? SUBJECT_WEIGHT : 1)
    idf.set(term, weight)
    // A term only one outlet has ever used is that outlet's house style — a
    // byline, a credit, a section name — and says nothing about corroboration.
    const specificAt = Math.max(MIN_SPECIFIC_DOCS, size * GENERIC_SHARE)
    if (n <= specificAt && (sources.get(term)?.size ?? 0) > 1) {
      evidential.add(term)
    }
  }
  return { size, bar: EVIDENCE_RATIO * Math.log(size), idf, evidential }
}

const evidenceOf = (a: Set<string>, b: Set<string>, corpus: Corpus): number => {
  let total = 0
  for (const term of a) {
    if (b.has(term)) total += corpus.idf.get(term) ?? 0
  }
  return total
}

const hoursApart = (a: string | null, b: string | null): number => {
  if (!a || !b) return Infinity
  const ta = Date.parse(a.replace(' ', 'T'))
  const tb = Date.parse(b.replace(' ', 'T'))
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity
  return Math.abs(ta - tb) / 3_600_000
}

const intersect = (sets: Set<string>[]): Set<string> => {
  if (sets.length === 0) return new Set()
  let acc = sets[0]
  for (const s of sets.slice(1)) acc = new Set([...acc].filter((t) => s.has(t)))
  return acc
}

/**
 * The event this article belongs to, or null when it starts its own.
 *
 * `recent` is every analysed article inside the window, each already carrying
 * the event it was assigned. They are grouped back into events here rather than
 * stored as groups, so a change to any rule above takes effect on the next
 * article without a migration.
 */
export function findEvent(article: Article, recent: Article[]): string | null {
  const pool = recent.filter((r) => r.id !== article.id && r.event_id)
  if (pool.length < MIN_CORPUS) return null

  const scored: Scored[] = pool.map((a) => ({ article: a, terms: extractTerms(a) }))
  const corpus = buildCorpus([...scored, { article, terms: extractTerms(article) }])

  const mine = new Set([...extractTerms(article)].filter((t) => corpus.evidential.has(t)))
  if (mine.size === 0) return null

  const events = new Map<string, Scored[]>()
  for (const s of scored) {
    const key = s.article.event_id as string
    const members = events.get(key)
    if (members) members.push(s)
    else events.set(key, [s])
  }

  let best: { id: string; hits: number } | null = null

  for (const [eventId, members] of events) {
    if (members[0].article.category !== article.category) continue

    const memberTerms = members.map(
      (m) => new Set([...m.terms].filter((t) => corpus.evidential.has(t))),
    )

    // The event must still be naming one thing. Every false merge in the
    // offline sweep had an empty intersection across its members; every correct
    // one kept a term — Nevada, Guinea, World Humanoid Robot Games.
    const core = intersect(memberTerms)
    let sharesCore = false
    for (const t of core) if (mine.has(t)) { sharesCore = true; break }
    if (!sharesCore) continue

    let hits = 0
    for (let i = 0; i < members.length; i++) {
      if (hoursApart(article.published_at, members[i].article.published_at) > WINDOW_HOURS) continue
      if (evidenceOf(mine, memberTerms[i], corpus) >= corpus.bar) hits++
    }

    if (hits >= Math.max(1, Math.ceil(members.length * MAJORITY))) {
      if (!best || hits > best.hits) best = { id: eventId, hits }
    }
  }

  if (best) {
    logger.debug('[Event]', `"${article.title.slice(0, 44)}…" joins ${best.id.slice(0, 8)} (${best.hits} match)`)
  }
  return best?.id ?? null
}
