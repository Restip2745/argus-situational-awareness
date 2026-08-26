import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Article, OllamaClassification, ClientEvent, SourceReliability, MarketCommodity } from '../types'
import { resolveLocation } from '../data/gazetteer'
import { logger } from '../utils/logger'
import { resolveDbPath } from '../config/paths'

let db: Database.Database

export function initDb(): void {
  const dbPath = resolveDbPath()
  // A fresh clone has no data/ until the first write lands.
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Migration: drop old `events` table if it exists
  const oldTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
    .get()
  if (oldTable) {
    logger.info('[DB]', 'Migrating: dropping old events table')
    db.exec('DROP TABLE IF EXISTS events')
  }

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
  db.exec(schema)

  // Migration: add reliability column if missing (schema may already exist)
  const cols = db.prepare("PRAGMA table_info(articles)").all() as { name: string }[]
  if (!cols.some(c => c.name === 'reliability')) {
    db.exec("ALTER TABLE articles ADD COLUMN reliability TEXT")
    logger.info('[DB]', 'Migration: added reliability column')
  }
  if (!cols.some(c => c.name === 'market_link')) {
    db.exec("ALTER TABLE articles ADD COLUMN market_link TEXT")
    logger.info('[DB]', 'Migration: added market_link column')
  }
  if (!cols.some(c => c.name === 'image_url')) {
    db.exec("ALTER TABLE articles ADD COLUMN image_url TEXT")
    logger.info('[DB]', 'Migration: added image_url column')
  }
  if (!cols.some(c => c.name === 'summary_en')) {
    db.exec("ALTER TABLE articles ADD COLUMN summary_en TEXT")
    logger.info('[DB]', 'Migration: added summary_en column')
  }
  if (!cols.some(c => c.name === 'event_id')) {
    db.exec("ALTER TABLE articles ADD COLUMN event_id TEXT")
    db.exec("CREATE INDEX IF NOT EXISTS idx_articles_event ON articles(event_id)")
    logger.info('[DB]', 'Migration: added event_id column')
  }
  if (!cols.some(c => c.name === 'geo_precision')) {
    db.exec("ALTER TABLE articles ADD COLUMN geo_precision TEXT")
    logger.info('[DB]', 'Migration: added geo_precision column')
    logger.info('[DB]', 'Existing rows have no precision — run scripts/backfill-geo.ts')
  }

  logger.info('[DB]', 'SQLite initialised (articles schema)')
}

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialised — call initDb() first')
  return db
}

// ── Insert helpers ──────────────────────────────────────

interface RawArticleInput {
  id: string
  source: string
  title: string
  content: string | null
  url: string
  published_at: string | null
  image_url: string | null
}

const _insertRaw = () => getDb().prepare(
  `INSERT OR IGNORE INTO articles (id, source, title, content, url, published_at, image_url)
   VALUES (@id, @source, @title, @content, @url, @published_at, @image_url)`
)

export function insertRawArticle(article: RawArticleInput): boolean {
  const result = _insertRaw().run(article)
  return result.changes > 0
}

export interface WebhookEventInput {
  id:             string
  title:          string
  category:       string
  intensity:      string
  location_label: string | null
  location_type:  string | null
  lat:            number | null
  lng:            number | null
  actors:         string[]
  tags:           string[]
  source:         string
  url:            string
  published_at:   string
  heat_score:     number
  expires_at:     string
}

export function insertWebhookEvent(e: WebhookEventInput): void {
  // Webhook callers are no more reliable about coordinates than the model is,
  // so they go through the same resolution rather than straight into the row.
  const geo = e.location_type === 'orbital'
    ? { lat: e.lat, lng: e.lng, precision: 'exact' as const }
    : resolveLocation(e.location_label, e.lat, e.lng)

  getDb().prepare(
    `INSERT OR IGNORE INTO articles
      (id, source, title, content, url, published_at, is_analyzed,
       category, title_zh, summary_zh, intensity,
       location_type, location_label, lat, lng, geo_precision, body,
       actors, tags, sources_count, reliability, heat_score, expires_at)
     VALUES
      (@id, @source, @title, NULL, @url, @published_at, 1,
       @category, @title, '', @intensity,
       @location_type, @location_label, @lat, @lng, @geo_precision, NULL,
       @actors, @tags, 1, 'MEDIUM', @heat_score, @expires_at)`
  ).run({
    ...e,
    lat:           geo.lat,
    lng:           geo.lng,
    geo_precision: geo.precision,
    actors: JSON.stringify(e.actors),
    tags:   JSON.stringify(e.tags),
  })
}

// ── Query helpers ───────────────────────────────────────

/**
 * The next articles to classify, feed window first.
 *
 * Oldest-fetched-first is the obvious order and it starves the only thing the
 * operator can see. The client is served analysed rows alone, and the feed
 * shows a window of at most 24 hours, so a backlog — a restart re-reads every
 * source at once and builds one — is worked through from the end that can no
 * longer appear anywhere. Measured on a real one: 224 pending, 87 of them
 * already outside the widest window, and the model taking 78 seconds each, so
 * the feed would have stayed empty for about five hours while the queue
 * chewed through articles whose only destination was the retention worker.
 *
 * Two classes, FIFO within each, so nothing is starved — the tail is still
 * analysed, just after the material that has somewhere to go. The datetime()
 * call is not decoration: published_at is stored ISO with a T and a Z, and
 * comparing it to SQLite's own format as text reads 2026-08-17T05:00Z as newer
 * than 2026-08-17 09:38, putting four out-of-window rows in the wrong class.
 */
export const PENDING_ORDER_BY =
  "ORDER BY (datetime(published_at) >= datetime('now','-24 hours')) DESC, fetched_at ASC"

export function getPendingArticles(limit = 10): Article[] {
  return getDb()
    .prepare('SELECT * FROM articles WHERE is_analyzed = 0 ' + PENDING_ORDER_BY + ' LIMIT ?')
    .all(limit) as Article[]
}

export function getArticleById(id: string): Article | null {
  return (getDb()
    .prepare('SELECT * FROM articles WHERE id = ?')
    .get(id) as Article) ?? null
}

export function getTopHeatEvents(limit = 5): ClientEvent[] {
  const rows = getDb()
    .prepare('SELECT * FROM articles WHERE is_analyzed = 1 ORDER BY heat_score DESC LIMIT ?')
    .all(limit) as Article[]
  return rows.map(articleToClientEvent)
}

/**
 * Analysed events, hottest first.
 *
 * `limit` is a ceiling rather than a page size — the ordering puts the events
 * most worth keeping at the front, so a truncated response still carries the
 * ones that matter rather than an arbitrary slice.
 */
export function getAnalyzedArticles(limit?: number): ClientEvent[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM articles WHERE is_analyzed = 1' +
      ' ORDER BY heat_score DESC, published_at DESC' +
      (limit === undefined ? '' : ' LIMIT ?'),
    )
    .all(...(limit === undefined ? [] : [limit])) as Article[]

  return rows.map(articleToClientEvent)
}

/**
 * Analysed articles recent enough for a new story to join, newest first.
 *
 * The matcher needs both the candidate events and the corpus that says which
 * terms are rare, and one query serves as both — document frequency measured
 * over a rolling window tracks the week's news rather than a frozen vocabulary.
 */
export function getRecentAnalysed(hours: number): Article[] {
  return getDb()
    .prepare(
      `SELECT * FROM articles
       WHERE is_analyzed = 1 AND event_id IS NOT NULL
         AND datetime(published_at) > datetime('now', ?)
       ORDER BY published_at DESC`,
    )
    .all(`-${hours} hours`) as Article[]
}

/**
 * How many distinct outlets carried each event.
 *
 * This is the number `sources_count` was always meant to hold. Until now it was
 * the model's answer to a question it could not see the evidence for — how many
 * other newsrooms ran this story — asked from inside a single article, which is
 * why it almost always said one.
 *
 * Rebuilt on demand rather than per row: the read paths map whole result sets
 * through `articleToClientEvent`, and a query per article would turn one read
 * into hundreds.
 */
let sourceCountsDirty = true
let sourceCounts = new Map<string, number>()

function eventSourceCount(eventId: string | null): number | null {
  if (!eventId) return null
  if (sourceCountsDirty) {
    const rows = getDb()
      .prepare(
        `SELECT event_id, COUNT(DISTINCT source) AS n FROM articles
         WHERE is_analyzed = 1 AND event_id IS NOT NULL GROUP BY event_id`,
      )
      .all() as { event_id: string; n: number }[]
    sourceCounts = new Map(rows.map((r) => [r.event_id, r.n]))
    sourceCountsDirty = false
  }
  return sourceCounts.get(eventId) ?? null
}

/** Retention deletes rows, which changes the counts. */
export function invalidateSourceCounts(): void {
  sourceCountsDirty = true
}

// ── Update helpers ──────────────────────────────────────

export function markAnalyzed(
  id: string,
  data: OllamaClassification,
  heatScore: number,
  expiresAt: string,
  eventId: string | null = null,
): void {
  getDb().prepare(
    `UPDATE articles SET
       is_analyzed    = 1,
       category       = @category,
       title_zh       = @title_zh,
       summary_zh     = @summary_zh,
       summary_en     = @summary_en,
       intensity      = @intensity,
       location_type  = @location_type,
       location_label = @location_label,
       lat            = @lat,
       lng            = @lng,
       geo_precision  = @geo_precision,
       body           = @body,
       actors         = @actors,
       tags           = @tags,
       sources_count  = @sources_count,
       reliability    = @reliability,
       market_link    = @market_link,
       heat_score     = @heat_score,
       expires_at     = @expires_at,
       event_id       = @event_id
     WHERE id = @id`
  ).run({
    id,
    category:       data.category,
    title_zh:       data.title_zh,
    summary_zh:     data.summary_zh,
    summary_en:     data.summary_en,
    intensity:      data.intensity,
    location_type:  data.location.type,
    location_label: data.location.label,
    lat:            data.location.lat,
    lng:            data.location.lng,
    geo_precision:  data.location.precision,
    body:           data.location.body,
    actors:         JSON.stringify(data.actors),
    tags:           JSON.stringify(data.tags),
    sources_count:  data.sources_count,
    reliability:    data.reliability,
    // Stored as JSON so the column stays null for the great majority of rows,
    // which is what "no link" looks like.
    market_link:    data.market_link ? JSON.stringify(data.market_link) : null,
    heat_score:     heatScore,
    expires_at:     expiresAt,
    // NULL until a caller supplies one. The read path falls back to the
    // model's own sources_count for those rows, which is today's behaviour.
    event_id:       eventId,
  })
  sourceCountsDirty = true
}

export function markAnalysisFailed(id: string): void {
  getDb()
    .prepare('UPDATE articles SET is_analyzed = -1 WHERE id = ?')
    .run(id)
}

export function resetFailedArticles(): number {
  const result = getDb()
    .prepare('UPDATE articles SET is_analyzed = 0 WHERE is_analyzed = -1')
    .run()
  return result.changes
}

export function updateHeatScore(id: string, newScore: number, newExpiresAt: string): void {
  getDb().prepare(
    `UPDATE articles SET
       heat_score     = ?,
       expires_at     = ?,
       last_referenced = datetime('now')
     WHERE id = ?`
  ).run(newScore, newExpiresAt, id)
}

// ── Retention helpers ───────────────────────────────────

export function findAnalyzedArticles(): Article[] {
  return getDb()
    .prepare('SELECT * FROM articles WHERE is_analyzed = 1')
    .all() as Article[]
}

export function deleteExpiredArticles(): number {
  let total = 0

  sourceCountsDirty = true

  // Condition 1: expired + not recently referenced
  const r1 = getDb().prepare(
    `DELETE FROM articles
     WHERE datetime(expires_at) < datetime('now')
       AND (last_referenced < datetime('now', '-24 hours') OR last_referenced IS NULL)`
  ).run()
  total += r1.changes

  // Condition 2: critically low heat score AND already expired
  // (don't purge fresh LOW articles before they've had a chance to be shown)
  const r2 = getDb().prepare(
    `DELETE FROM articles
     WHERE heat_score < 0.2 AND is_analyzed = 1
       AND datetime(expires_at) < datetime('now')`
  ).run()
  total += r2.changes

  return total
}

// ── Conversion ──────────────────────────────────────────

export function articleToClientEvent(row: Article): ClientEvent {
  return {
    id:              row.id,
    title:           row.title,
    // `||` not `??`: an article the model could not translate stores '' here,
    // and an empty string is exactly the case that must fall back to the
    // original title. `??` only catches null and let '' through.
    title_zh:        row.title_zh || row.title,
    content:         row.content,
    summary_zh:      row.summary_zh ?? '',
    summary_en:      row.summary_en ?? '',
    source:          row.source,
    url:             row.url,
    published_at:    row.published_at,
    fetched_at:      row.fetched_at,
    category:        row.category!,
    intensity:       row.intensity!,
    location_type:   row.location_type as 'geo' | 'orbital',
    location_label:  row.location_label ?? '',
    lat:             row.lat,
    lng:             row.lng,
    // Rows written before resolution moved server-side carry no precision.
    // Coordinates on those came straight from the model, hence 'exact'.
    geo_precision:   row.geo_precision ?? (row.lat !== null && row.lng !== null ? 'exact' : 'none'),
    body:            row.body,
    actors:          safeJsonParse(row.actors),
    tags:            safeJsonParse(row.tags),
    // Measured where the event is known, and only the model's guess where it
    // is not — rows analysed before matching existed carry no event_id.
    sources_count:   eventSourceCount(row.event_id) ?? row.sources_count ?? 1,
    reliability:     (row.reliability ?? 'UNVERIFIED') as SourceReliability,
    // Null for the great majority of rows, and an empty array is what the
    // client wants to see for those — nothing to render rather than a missing
    // field to guard against.
    market_link:     safeJsonParse(row.market_link) as MarketCommodity[],
    heat_score:      row.heat_score,
    expires_at:      row.expires_at,
    last_referenced: row.last_referenced,
    image_url:       row.image_url ?? null,
  }
}

function safeJsonParse(json: string | null): string[] {
  if (!json) return []
  try { return JSON.parse(json) } catch { return [] }
}

// ── Related events ──────────────────────────────────────

/**
 * Find events related to a given article by actor/tag overlap.
 * Scoring: +2 per shared actor, +1 per shared tag, +1 for same location.
 * Returns up to `limit` events sorted by score DESC, published_at DESC.
 */
export function getRelatedEvents(id: string, limit = 8): ClientEvent[] {
  const target = getDb()
    .prepare('SELECT * FROM articles WHERE id = ? AND is_analyzed = 1')
    .get(id) as Article | undefined
  if (!target) return []

  const targetActors = new Set(safeJsonParse(target.actors))
  const targetTags   = new Set(safeJsonParse(target.tags))
  const targetLoc    = target.location_label?.toLowerCase() ?? ''

  const others = getDb()
    .prepare('SELECT * FROM articles WHERE is_analyzed = 1 AND id != ? ORDER BY published_at DESC')
    .all(id) as Article[]

  const scored = others
    .map((row) => {
      const actors = safeJsonParse(row.actors)
      const tags   = safeJsonParse(row.tags)
      let score = 0
      for (const a of actors) if (targetActors.has(a)) score += 2
      for (const t of tags)   if (targetTags.has(t))   score += 1
      const loc = row.location_label?.toLowerCase() ?? ''
      if (loc && loc === targetLoc) score += 1
      return { row, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.row.published_at ?? '').localeCompare(a.row.published_at ?? ''))
    .slice(0, limit)

  return scored.map((x) => articleToClientEvent(x.row))
}
