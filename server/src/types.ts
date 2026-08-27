// ────────────────────────────────────────────────────────────
// Event categories (9 types)
// ────────────────────────────────────────────────────────────

export type EventCategory =
  | 'ARMED_CONFLICT'
  | 'POLITICAL'
  | 'ECONOMIC'
  | 'SOCIAL'
  | 'SCIENCE_TECH'
  | 'ENVIRONMENT'
  | 'HEALTH'
  | 'CRIME_SECURITY'
  | 'SPACE'

export const VALID_CATEGORIES: EventCategory[] = [
  'ARMED_CONFLICT', 'POLITICAL', 'ECONOMIC', 'SOCIAL',
  'SCIENCE_TECH', 'ENVIRONMENT', 'HEALTH', 'CRIME_SECURITY', 'SPACE',
]

export type EventIntensity = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
export type SourceReliability = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'

import type { GeoPrecision } from './data/gazetteer'
export type { GeoPrecision }

export const VALID_INTENSITIES: EventIntensity[] = [
  'LOW', 'MODERATE', 'HIGH', 'CRITICAL',
]

// ────────────────────────────────────────────────────────────
// Article (DB row — matches `articles` table)
// ────────────────────────────────────────────────────────────

export interface Article {
  id: string                          // SHA-256 of URL
  source: string
  title: string
  content: string | null
  url: string
  published_at: string | null
  fetched_at: string

  is_analyzed: 0 | 1 | -1

  // Ollama output (NULL before analysis)
  category: EventCategory | null
  title_zh: string | null
  summary_zh: string | null
  summary_en: string | null
  intensity: EventIntensity | null
  location_type: 'geo' | 'orbital' | null
  location_label: string | null
  lat: number | null
  lng: number | null
  /** Where lat/lng came from — see GeoPrecision. NULL on rows written before
   *  coordinate resolution moved server-side. */
  geo_precision: GeoPrecision | null
  body: string | null
  actors: string | null               // JSON array string in DB
  tags: string | null                  // JSON array string in DB
  sources_count: number | null
  reliability: SourceReliability | null
  market_link: string | null           // JSON array string in DB, NULL for most rows

  /** The happening this article reports, shared with every other article about
   *  it. Seeded from the first article seen, so a lone story carries its own
   *  id. NULL on rows analysed before event matching existed. */
  event_id: string | null

  image_url: string | null

  // Heat Score
  heat_score: number
  expires_at: string | null
  last_referenced: string | null
}

// ────────────────────────────────────────────────────────────
// Ollama classification result (parsed JSON from LLM)
// ────────────────────────────────────────────────────────────

export interface OllamaClassification {
  category: EventCategory
  intensity: EventIntensity
  /** Chinese title. Empty string when the model did not return a usable one —
   *  callers fall back to the source's own title rather than showing nothing. */
  title_zh: string
  summary_zh: string
  summary_en: string
  location: {
    type: 'geo' | 'orbital'
    label: string
    /** Resolved against the gazetteer, not raw model output — roughly half of
     *  geo articles come back with a usable label and no coordinates. */
    lat: number | null
    lng: number | null
    precision: GeoPrecision
    body: string | null
  }
  actors: string[]
  sources_count: number
  tags: string[]
  reliability: SourceReliability
  /** Commodity markets the article bears on, or null — which is the usual answer. */
  market_link: MarketLink | null
}

// ────────────────────────────────────────────────────────────
// Market linkage
// ────────────────────────────────────────────────────────────

/**
 * Commodity classes the model may name.
 *
 * Deliberately wider than what the status bar draws. Offering only the four
 * instruments on screen would push a gas or wheat story into CRUDE_OIL for want
 * of anywhere better to put it; an unused option is an escape hatch that keeps
 * the answer honest, and one that maps to no instrument simply shows nothing.
 *
 * These are classes, not tickers. Which contract stands for CRUDE_OIL is a
 * display decision and belongs with the display — the article is about crude,
 * not about Brent specifically.
 */
export type MarketCommodity =
  | 'CRUDE_OIL'
  | 'NATURAL_GAS'
  | 'GOLD'
  | 'SILVER'
  | 'COPPER'
  | 'WHEAT'

export const VALID_MARKET_COMMODITIES: MarketCommodity[] = [
  'CRUDE_OIL', 'NATURAL_GAS', 'GOLD', 'SILVER', 'COPPER', 'WHEAT',
]

/**
 * The commodities an article bears on, or null when it bears on none.
 *
 * There was a `relation` field here — SUBJECT for an article about a
 * commodity's own price, AFFECTED for one reporting damage to what produces or
 * carries it — meant to force the model to discriminate rather than
 * pattern-match. Over three replays of 200 articles it answered AFFECTED
 * essentially every time: 1 SUBJECT out of 18 links, then 1 of 12, then 0 of
 * 12, including for headlines that were plainly about the commodity itself.
 * A field that only ever takes one value is not information, so it was removed
 * rather than left to look like a distinction the data does not support.
 */
export type MarketLink = MarketCommodity[]

// ────────────────────────────────────────────────────────────
// Client-facing event (broadcast via Socket.io + REST)
// ────────────────────────────────────────────────────────────

export interface ClientEvent {
  id: string
  title: string
  title_zh: string
  content: string | null       // Original RSS content snippet
  summary_zh: string
  summary_en: string
  source: string
  url: string
  published_at: string | null
  fetched_at: string
  category: EventCategory
  intensity: EventIntensity
  location_type: 'geo' | 'orbital'
  location_label: string
  lat: number | null
  lng: number | null
  geo_precision: GeoPrecision
  body: string | null
  actors: string[]
  tags: string[]
  sources_count: number
  reliability: SourceReliability
  /** Commodity classes the article bears on, empty for almost every event. */
  market_link: MarketCommodity[]
  heat_score: number
  expires_at: string | null
  last_referenced: string | null
  image_url: string | null
}

// ────────────────────────────────────────────────────────────
// RSS feed item (from rss-parser)
// ────────────────────────────────────────────────────────────

export interface RawFeedItem {
  title: string
  link: string
  contentSnippet?: string
  pubDate?: string
  isoDate?: string
  enclosure?: { url?: string; type?: string; length?: string }
  mediaContent?: { $?: { url?: string } } | { $?: { url?: string } }[]
  mediaThumbnail?: { $?: { url?: string } }
  /** YouTube Atom feeds nest everything under <media:group>; the top-level
   *  media:* fields above are absent there. Values arrive as single-item arrays. */
  mediaGroup?: {
    'media:description'?: string[]
    'media:thumbnail'?: { $?: { url?: string } }[]
  }
}
