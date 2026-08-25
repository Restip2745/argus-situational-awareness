// ────────────────────────────────────────────────────────────
// Celestial body identifiers
// ────────────────────────────────────────────────────────────

export type CelestialBodyName =
  | 'sun'
  // Planets
  | 'mercury' | 'venus' | 'earth' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune'
  // Dwarf planets / KBOs
  | 'pluto' | 'ceres' | 'eris' | 'makemake' | 'haumea'
  // Earth's Moon
  | 'moon'
  // Mars moons
  | 'phobos' | 'deimos'
  // Jupiter moons (Galilean)
  | 'io' | 'europa' | 'ganymede' | 'callisto'
  // Saturn moons
  | 'titan' | 'enceladus' | 'mimas' | 'rhea' | 'dione'
  // Uranus moons
  | 'miranda' | 'ariel' | 'umbriel' | 'titania' | 'oberon'
  // Neptune moons
  | 'triton'
  // Notable asteroids
  | 'vesta' | 'apophis' | 'bennu'
  // Comets
  | 'halley' | '67p'
  // Interstellar objects
  | '3i-atlas'

// ────────────────────────────────────────────────────────────
// Event data
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

export type EventIntensity = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
export type SourceReliability = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED'

/**
 * Where an event's coordinates came from. The server resolves this once at
 * classification time — the client never derives coordinates itself.
 *
 *   exact    — the model named a point
 *   centroid — resolved from the location label via the server gazetteer
 *   region   — a real area ("Europe", "Global Tech Sector") with no one point
 *   none     — nothing resolvable
 *
 * `region` and `none` both mean lat/lng are null, but they are not the same
 * thing: the first has nowhere to put a marker, the second is a gap.
 */
export type GeoPrecision = 'exact' | 'centroid' | 'region' | 'none'

/**
 * Commodity classes an event can be linked to.
 *
 * Mirrors the server's list. These are classes rather than tickers: which
 * contract stands for CRUDE_OIL is a display decision, and lives in
 * `data/commodities.ts` beside the instruments the status bar draws.
 */
export type MarketCommodity =
  | 'CRUDE_OIL'
  | 'NATURAL_GAS'
  | 'GOLD'
  | 'SILVER'
  | 'COPPER'
  | 'WHEAT'

export interface ArgusEvent {
  id: string
  title: string
  title_zh: string | null
  content: string | null       // Original RSS content snippet
  summary_zh: string | null
  summary_en: string | null
  source: string
  url: string
  published_at: string
  fetched_at: string
  category: EventCategory
  intensity: EventIntensity
  // Location
  location_type: 'geo' | 'orbital' | null
  location_label: string | null
  lat: number | null
  lng: number | null
  geo_precision: GeoPrecision
  /**
   * The celestial body as the model wrote it — "Mars", "Saturn's B Ring",
   * "Carina Nebula" — not a CelestialBodyName. It is unvalidated prose and
   * frequently names nothing in the body table at all, so resolve it through
   * resolveOrbitalPlacement() rather than comparing or casting it. Typing it
   * as CelestialBodyName is what hid a Mars event focusing on nothing.
   */
  body: string | null
  // Intelligence metadata
  actors: string[]          // Parsed from JSON string
  tags: string[]            // Parsed from JSON string
  sources_count: number
  reliability: SourceReliability
  /**
   * Commodity classes this event bears on.
   *
   * Optional because it arrived long after the shape settled and is absent from
   * every event stored or mocked before it existed. Consumers must read absent
   * and empty as the same thing — no link — which is what all but a few percent
   * of events carry anyway.
   */
  market_link?: MarketCommodity[]
  image_url: string | null
  // Heat Score
  heat_score: number
  expires_at: string | null
  last_referenced: string | null
}

// ────────────────────────────────────────────────────────────
// Person entity (for WikiPanel / entity linking)
// ────────────────────────────────────────────────────────────

export interface WikiEntity {
  name:        string
  description: string | null   // Wikidata short description
  extract:     string | null   // Wikipedia first paragraph
  thumbnail:   string | null   // image URL
  wikiUrl:     string | null   // Wikipedia desktop page URL
}

// ────────────────────────────────────────────────────────────
// Context entity (unified type for MultiEntityContextPanel)
// ────────────────────────────────────────────────────────────

export type ContextEntityType = 'event' | 'wiki' | 'region' | 'celestial'

export interface ContextEntity {
  id:      string
  type:    ContextEntityType
  name:    string
  summary: string
}

// ────────────────────────────────────────────────────────────
// Annotation canvas (legacy strokes — kept for type compat)
// ────────────────────────────────────────────────────────────

export interface AnnotationStroke {
  id: string
  sessionId: string
  points: [number, number][]
  color: string
  width: number
  createdAt: string
}

// ────────────────────────────────────────────────────────────
// 3D Annotation system — pins + links
// ────────────────────────────────────────────────────────────

export interface AnnotationPin {
  id: string
  bodyId: CelestialBodyName
  lat: number
  lng: number
  icon: string    // emoji character
  color: string   // hex color
  label: string
}

export interface AnnotationLink {
  id: string
  fromId: string  // AnnotationPin.id
  toId: string    // AnnotationPin.id
  label: string
  color: string   // hex color
}

export type AnnotationTool = 'pin' | 'link' | 'erase'

export interface PendingPin {
  bodyId: CelestialBodyName
  lat: number
  lng: number
}

export interface PendingLink {
  fromId: string
  toId: string
}
