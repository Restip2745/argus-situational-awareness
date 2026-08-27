import { create } from 'zustand'
import type {
  ArgusEvent, CelestialBodyName, AnnotationStroke, ContextEntity,
  AnnotationPin, AnnotationLink, AnnotationTool, PendingPin, PendingLink,
} from '../types'
import type { NavLevelId } from '../config/navLevels'
import { NAV_LEVELS } from '../config/navLevels'
import type { BodyDef } from '../data/celestialBodies'

const CONTEXT_ENTITY_LIMIT = 8

const CONTEXT_KEY = 'argus-context-entities'

/**
 * Hard cap on how many events the client holds at once.
 *
 * Matches the server's own DEFAULT_EVENT_LIMIT/MAX_EVENT_LIMIT — if the
 * backend considers 2000 the meaningful working set, the client shouldn't
 * accumulate more than that across a long-running session. Without this,
 * `addEvent` prepends forever and every per-second consumer of the event
 * list (filtering, sorting, marker clustering) does steadily more work the
 * longer the tab stays open.
 */
const EVENTS_CAP = 2000

function loadContextEntities(): ContextEntity[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    // Shape-check each row: this is user-editable storage that outlives the
    // code that wrote it, and a malformed entry would break the panel render.
    return raw
      .filter((e): e is ContextEntity =>
        !!e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.type === 'string')
      .slice(0, CONTEXT_ENTITY_LIMIT)
  } catch { return [] }
}

function persistContextEntities(list: ContextEntity[]): void {
  try { localStorage.setItem(CONTEXT_KEY, JSON.stringify(list)) } catch { /* quota / private mode */ }
}

/**
 * Earth surface fill modes.
 *   none      outlines only
 *   political neutral four-colour fills — legibility, carries no meaning
 *   posture   worst live severity per country, on the severity ramp
 *   activity  event volume per country, single-hue sequential
 */
export type MapMode = 'none' | 'political' | 'posture' | 'activity'

/**
 * Surface fill for the solar-system view.
 *
 * Only two, because at that range there is one question worth answering —
 * which bodies have anything happening — and the Earth modes are all painting
 * a globe that is a few pixels across.
 */
export type SpaceMapMode = 'none' | 'posture'

/**
 * How much chrome the HUD is showing.
 *
 * One axis, three stops, because that is what this always was. It used to be
 * two independent booleans — `liteMode` and `immersiveMode` — which described
 * points on the same scale and then had to forbid one of their four
 * combinations by hand. That special case was the tell.
 *
 *   full       sidebar feed, every readout and control
 *   compact    the icon stack instead of the sidebar, controls still up
 *   immersive  the icon stack alone, over a clean globe
 *
 * The stack survives into `immersive` deliberately. This is a monitoring
 * tool, and a view with no channel for "something just happened" is a
 * screensaver; 26px at the left edge is what that awareness costs.
 */
export type HudMode = 'full' | 'compact' | 'immersive'

/** Named so call sites state their intent rather than matching strings. */
export const showsSidebar    = (m: HudMode): boolean => m === 'full'
export const showsEventStack = (m: HudMode): boolean => m !== 'full'
export const showsChrome     = (m: HudMode): boolean => m !== 'immersive'

export type TimeRangeFilter = '6h' | '12h' | '24h' | 'all'

/**
 * Time window the feed opens on. 6h rather than 'all' so a first load reads as
 * "what is happening now" instead of a backlog to wade through.
 *
 * Exported because "is the feed filtered?" is asked in several places, and each
 * of them has to mean *this* value — comparing against a hard-coded 'all' would
 * make the default state advertise itself as an active filter.
 */
export const DEFAULT_TIME_RANGE: TimeRangeFilter = '6h'

export interface FilterPreset {
  id: string
  name: string
  hiddenCategories: string[]
  timeRangeFilter: '6h' | '12h' | '24h' | 'all'
  searchQuery: string
}

export interface SelectedEntity {
  name: string
  wikiTitle?: string
}

export interface SelectedCountry {
  name: string
  lat: number
  lng: number
}

interface AppState {
  // ── Events ────────────────────────────────────────────────
  events: ArgusEvent[]
  setEvents: (events: ArgusEvent[]) => void
  addEvent: (event: ArgusEvent) => void

  // ── Camera / Focus ────────────────────────────────────────
  focusedBody: CelestialBodyName | null
  setFocusedBody: (body: CelestialBodyName | null) => void
  goBack: (() => void) | null
  setGoBack: (fn: () => void) => void
  /** Exposed focusOn from SolarSystem for UI components (e.g. CelestialNavList) */
  focusOn: ((bodyId: CelestialBodyName) => void) | null
  setFocusOn: (fn: (bodyId: CelestialBodyName) => void) => void
  /** Reset camera to solar system overview */
  resetToSolarView: (() => void) | null
  setResetToSolarView: (fn: () => void) => void

  // ── Celestial Navigation ──────────────────────────────────
  navLevel: NavLevelId
  navCandidates: BodyDef[]
  navCollapsed: boolean
  setNavLevel: (level: NavLevelId) => void
  setNavCandidates: (candidates: BodyDef[]) => void
  setNavCollapsed: (v: boolean) => void

  // ── Panel ─────────────────────────────────────────────────
  activePanelId: string | null
  setActivePanelId: (id: string | null) => void

  // ── Selected celestial body (for info panel) ──────────────
  selectedBody: CelestialBodyName | null
  setSelectedBody: (body: CelestialBodyName | null) => void

  // ── Scene layers ──────────────────────────────────────────
  showEarthTexture: boolean
  setShowEarthTexture: (v: boolean) => void

  showGeoJsonLayer: boolean
  setShowGeoJsonLayer: (v: boolean) => void

  showEventMarkers: boolean
  setShowEventMarkers: (v: boolean) => void

  showAnnotationCanvas: boolean
  setShowAnnotationCanvas: (v: boolean) => void

  // ── Tracking layers ───────────────────────────────────────
  showAircraftLayer: boolean
  setShowAircraftLayer: (v: boolean) => void
  showSatellitesLayer: boolean
  setShowSatellitesLayer: (v: boolean) => void
  showShipsLayer: boolean
  setShowShipsLayer: (v: boolean) => void
  showConflictLayer: boolean
  setShowConflictLayer: (v: boolean) => void
  /** Earth surface fill. Exclusive by construction — only one variable may be
   *  painted across the globe at a time, or the fills become mud. Tracking
   *  overlays (aircraft, vessels, fronts) stay additive; they are point and
   *  line data, not a surface fill, so they do not compete. */
  mapMode: MapMode
  setMapMode: (v: MapMode) => void
  /** Surface fill for the solar-system view. Remembered separately from the
   *  Earth mode so flying out and back restores what the operator had, rather
   *  than one list overwriting the other's choice. */
  spaceMapMode: SpaceMapMode
  setSpaceMapMode: (v: SpaceMapMode) => void
  /** Whether the Earth surface modes can act at the current distance. Set from
   *  the scene with hysteresis; the selector shows one family or the other. */
  nearEarth: boolean
  setNearEarth: (v: boolean) => void
  layerErrors: { aircraft: boolean; satellites: boolean; ships: boolean; conflict: boolean }
  setLayerError: (layer: 'aircraft' | 'satellites' | 'ships' | 'conflict', error: boolean) => void
  layerLoading: { aircraft: boolean; satellites: boolean; ships: boolean; conflict: boolean }
  setLayerLoading: (layer: 'aircraft' | 'satellites' | 'ships' | 'conflict', loading: boolean) => void

  // ── Events loaded state ───────────────────────────────────
  eventsLoaded: boolean
  setEventsLoaded: (v: boolean) => void
  socketConnected: boolean
  setSocketConnected: (v: boolean) => void

  // ── Region selection (GeoJSON country click) ──────────────
  selectedCountry: SelectedCountry | null
  setSelectedCountry: (c: SelectedCountry | null) => void
  /** Callback registered by GeoJsonLayer; called by Earth mesh onClick */
  onEarthSurfaceClick: ((worldPt: { x: number; y: number; z: number }) => void) | null
  setOnEarthSurfaceClick: (fn: ((worldPt: { x: number; y: number; z: number }) => void) | null) => void
  /** Tween camera to a specific lat/lng on Earth's surface (set by SolarSystem) */
  focusOnEarthSurface: ((lat: number, lng: number) => void) | null
  setFocusOnEarthSurface: (fn: (lat: number, lng: number) => void) => void

  // ── Annotations (legacy 2D strokes) ──────────────────────
  strokes: AnnotationStroke[]
  addStroke: (stroke: AnnotationStroke) => void
  clearStrokes: () => void

  // ── 3D Annotation system ──────────────────────────────────
  annotationPins: AnnotationPin[]
  annotationLinks: AnnotationLink[]
  annotationTool: AnnotationTool
  pendingPin: PendingPin | null
  pendingLink: PendingLink | null
  pendingLinkFrom: string | null
  addAnnotationPin: (pin: AnnotationPin) => void
  removeAnnotationPin: (id: string) => void
  updateAnnotationPin: (id: string, patch: Partial<Omit<AnnotationPin, 'id'>>) => void
  addAnnotationLink: (link: AnnotationLink) => void
  removeAnnotationLink: (id: string) => void
  updateAnnotationLink: (id: string, patch: Partial<Omit<AnnotationLink, 'id'>>) => void
  setAnnotationTool: (tool: AnnotationTool) => void
  setPendingPin: (p: PendingPin | null) => void
  setPendingLink: (p: PendingLink | null) => void
  setPendingLinkFrom: (id: string | null) => void
  clearAnnotations: () => void

  // ── i18n ──────────────────────────────────────────────────
  language: string
  setLanguage: (lang: string) => void

  // ── Config modal ──────────────────────────────────────────
  showConfig: boolean
  setShowConfig: (v: boolean) => void

  // ── Display ───────────────────────────────────────────────
  uiScale: number
  setUiScale: (v: number) => void

  // ── Scene time ────────────────────────────────────────────
  /**
   * The instant the whole app is looking at.
   *
   * `null` means LIVE: everything follows the wall clock. A number freezes the
   * view at that timestamp — event filtering, the status bar's windows, the
   * map-mode aggregations and the astronomy all read it, so the intel and the
   * sky can never disagree about what "now" is.
   */
  sceneTime: number | null
  setSceneTime: (t: number | null) => void
  returnToLive: () => void

  // ── Presentation ──────────────────────────────────────────
  /** Where the camera lands on load. 'earth' puts the operator at the working
   *  altitude immediately; 'solar' keeps the old system-wide establishing shot. */
  homeView: 'earth' | 'solar'
  setHomeView: (v: 'earth' | 'solar') => void

  /** Backdrop nebula strength, 0 (off) to 2. Taste, not correctness — the
   *  right level depends on the display and how much the operator wants the
   *  scene to feel like somewhere rather than like a chart. */
  nebulaIntensity: number
  setNebulaIntensity: (v: number) => void

  /**
   * Which colour a rising price gets.
   *
   * There is no global answer: New York and London draw a gain green, Taipei
   * and Tokyo draw it red, and a reader from either convention misreads the
   * other's chart instantly. Stored as the colour rather than as a region name
   * because that is the actual decision — the region is only how the setting is
   * labelled.
   */
  upColor: 'green' | 'red'
  setUpColor: (v: 'green' | 'red') => void

  /** Decorative motion (hover tilt, sheen, staggered reveals). Off collapses
   *  the HUD to functional motion only — arrivals and state changes. */
  decorativeFx: boolean
  setDecorativeFx: (v: boolean) => void
  soundEnabled: boolean
  setSoundEnabled: (v: boolean) => void
  soundVolume: number
  setSoundVolume: (v: number) => void

  /**
   * Whether the event panel's agent section is expanded.
   *
   * A preference rather than per-panel state: the agent is the longest thing
   * in the panel and the one a reader either uses constantly or never, so the
   * answer holds across every event they open rather than being re-decided
   * each time. Collapsed still shows the section's header, so the feature does
   * not disappear for someone who put it away weeks ago.
   */
  agentSectionOpen: boolean
  setAgentSectionOpen: (v: boolean) => void

  // ── HUD chrome level ──────────────────────────────────────
  hudMode: HudMode
  setHudMode: (v: HudMode) => void
  /** Where `I` returns to. Immersive is a place you look up from, so it has
   *  to remember whether you were in the sidebar or the stack. */
  prevHudMode: HudMode
  toggleImmersive: () => void

  // ── Popout windows ────────────────────────────────────────
  poppedOut: Record<string, boolean>   // key: 'event' | 'region'
  setPoppedOut: (key: string, v: boolean) => void

  // ── Event category filter (for EventStack) ────────────────
  hiddenCategories: string[]
  toggleHiddenCategory: (cat: string) => void

  // ── Event time-range filter (for EventStack) ──────────────
  timeRangeFilter: '6h' | '12h' | '24h' | 'all'
  setTimeRangeFilter: (v: '6h' | '12h' | '24h' | 'all') => void

  // ── Event full-text search (for EventStack) ───────────────
  searchQuery: string
  setSearchQuery: (q: string) => void

  // ── Event sort order ─────────────────────────────────────
  eventSortOrder: 'newest' | 'heat' | 'intensity'
  setEventSortOrder: (v: 'newest' | 'heat' | 'intensity') => void

  // ── Personal event notes ─────────────────────────────────
  eventNotes: Record<string, string>
  setEventNote: (id: string, note: string) => void

  // ── Filter presets ────────────────────────────────────────
  filterPresets: FilterPreset[]
  saveFilterPreset: (name: string) => void
  applyFilterPreset: (id: string) => void
  deleteFilterPreset: (id: string) => void

  // ── Bookmark / Watchlist ──────────────────────────────────
  bookmarkedIds: string[]
  toggleBookmark: (id: string) => void
  showWatchlistOnly: boolean
  setShowWatchlistOnly: (v: boolean) => void

  // ── Intel brief (Periodic Intelligence Summary) ──────────
  intelBrief: { id: string; summary: string; generatedAt: string; topEventIds: string[] } | null
  setIntelBrief: (b: { id: string; summary: string; generatedAt: string; topEventIds: string[] }) => void
  briefRead: boolean
  setBriefRead: (v: boolean) => void
  intelBriefHistory: Array<{ id: string; summary: string; generatedAt: string; topEventIds: string[] }>

  // ── Person panel ──────────────────────────────────────────
  selectedEntities: SelectedEntity[]
  addSelectedEntity: (p: SelectedEntity) => void
  removeSelectedEntity: (name: string) => void
  clearSelectedEntities: () => void

  // ── Multi-entity context panel ─────────────────────────────
  contextEntities: ContextEntity[]
  showContextPanel: boolean
  setShowContextPanel: (v: boolean) => void
  addContextEntity: (e: ContextEntity) => void
  removeContextEntity: (id: string) => void
  clearContextEntities: () => void

  // ── Prediction markets panel ───────────────────────────────
  showPredictionPanel: boolean
  setShowPredictionPanel: (v: boolean) => void
  /** Bumped when the source changes, to make the panel re-read at once. */
  predictionEpoch: number
  bumpPredictionEpoch: () => void

  // ── Panel z-order (click to bring to front) ───────────────
  panelZ: Record<string, number>
  bringToFront: (key: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  // Events
  events:     [],
  setEvents:  (events) => set({ events: events.slice(0, EVENTS_CAP) }),
  addEvent:   (event) => set((s) => s.events.some(e => e.id === event.id)
    ? s
    : { events: [event, ...s.events].slice(0, EVENTS_CAP) }),

  // Camera
  focusedBody:    null,
  setFocusedBody: (focusedBody) => set({ focusedBody }),
  goBack:         null,
  setGoBack:      (fn) => set({ goBack: fn }),
  focusOn:        null,
  setFocusOn:     (fn) => set({ focusOn: fn }),
  resetToSolarView: null,
  setResetToSolarView: (fn) => set({ resetToSolarView: fn }),

  // Celestial Navigation
  navLevel:         'solar',
  navCandidates:    NAV_LEVELS[0].candidates(null),
  navCollapsed:     false,
  setNavLevel:      (navLevel) => set({ navLevel }),
  setNavCandidates: (navCandidates) => set({ navCandidates }),
  setNavCollapsed:  (navCollapsed) => set({ navCollapsed }),

  // Panel
  activePanelId:    null,
  setActivePanelId: (activePanelId) => set((s) => ({
    activePanelId,
    // Bring event panel to top whenever a new event is opened
    panelZ: activePanelId !== null
      ? { ...s.panelZ, event: Math.max(...Object.values(s.panelZ), 29) + 1 }
      : s.panelZ,
  })),

  // Selected celestial body
  selectedBody:    null,
  setSelectedBody: (selectedBody) => set((s) => ({
    selectedBody,
    // Bring celestial body panel to top whenever a body is selected
    panelZ: selectedBody !== null
      ? { ...s.panelZ, body: Math.max(...Object.values(s.panelZ), 29) + 1 }
      : s.panelZ,
  })),

  // Layers
  showEarthTexture:    true,
  setShowEarthTexture: (showEarthTexture) => set({ showEarthTexture }),

  showGeoJsonLayer:    false,
  setShowGeoJsonLayer: (showGeoJsonLayer) => set({ showGeoJsonLayer }),

  showEventMarkers:    false,
  setShowEventMarkers: (showEventMarkers) => set({ showEventMarkers }),

  showAnnotationCanvas:    false,
  setShowAnnotationCanvas: (showAnnotationCanvas) => set({ showAnnotationCanvas }),

  // Tracking layers
  showAircraftLayer:    false,
  setShowAircraftLayer: (showAircraftLayer) => set({ showAircraftLayer }),
  showSatellitesLayer:  false,
  setShowSatellitesLayer: (showSatellitesLayer) => set({ showSatellitesLayer }),
  showShipsLayer:       false,
  setShowShipsLayer:    (showShipsLayer) => set({ showShipsLayer }),
  showConflictLayer:    false,
  setShowConflictLayer: (showConflictLayer) => set({ showConflictLayer }),
  mapMode: ((): MapMode => {
    const saved = localStorage.getItem('argus-map-mode')
    return saved === 'none' || saved === 'political' || saved === 'posture' || saved === 'activity'
      ? saved
      // Posture by default. The home view sits outside the marker threshold, so
      // the choropleth is the only thing telling the operator where the trouble
      // is; neutral political fills would land them on a globe with no intel.
      : 'posture'
  })(),
  setMapMode: (mapMode) => {
    localStorage.setItem('argus-map-mode', mapMode)
    set({ mapMode })
  },
  spaceMapMode: ((): SpaceMapMode => {
    const saved = localStorage.getItem('argus-space-map-mode')
    // Posture by default for the same reason as the Earth view: arriving at a
    // system-wide shot with nothing marked says less than arriving at one that
    // shows which bodies have traffic.
    return saved === 'none' || saved === 'posture' ? saved : 'posture'
  })(),
  setSpaceMapMode: (spaceMapMode) => {
    localStorage.setItem('argus-space-map-mode', spaceMapMode)
    set({ spaceMapMode })
  },
  nearEarth: true,
  setNearEarth: (nearEarth) => set((s) => (s.nearEarth === nearEarth ? s : { nearEarth })),
  layerErrors: { aircraft: false, satellites: false, ships: false, conflict: false },
  setLayerError: (layer, error) => set((s) => ({ layerErrors: { ...s.layerErrors, [layer]: error } })),
  layerLoading: { aircraft: false, satellites: false, ships: false, conflict: false },
  setLayerLoading: (layer, loading) => set((s) => ({ layerLoading: { ...s.layerLoading, [layer]: loading } })),

  // Events loaded
  eventsLoaded: false,
  setEventsLoaded: (eventsLoaded) => set({ eventsLoaded }),
  socketConnected: false,
  setSocketConnected: (socketConnected) => set({ socketConnected }),

  // Region selection
  selectedCountry:    null,
  setSelectedCountry: (selectedCountry) => set((s) => ({
    selectedCountry,
    // Bring region panel to top whenever a country is selected
    panelZ: selectedCountry !== null
      ? { ...s.panelZ, region: Math.max(...Object.values(s.panelZ), 29) + 1 }
      : s.panelZ,
  })),
  onEarthSurfaceClick:    null,
  setOnEarthSurfaceClick: (fn) => set({ onEarthSurfaceClick: fn }),
  focusOnEarthSurface:    null,
  setFocusOnEarthSurface: (fn) => set({ focusOnEarthSurface: fn }),

  // Annotations (legacy 2D)
  strokes:      [],
  addStroke:    (stroke) => set((s) => ({ strokes: [...s.strokes, stroke] })),
  clearStrokes: () => set({ strokes: [] }),

  // 3D Annotation system
  annotationPins:    [],
  annotationLinks:   [],
  annotationTool:    'pin',
  pendingPin:        null,
  pendingLink:       null,
  pendingLinkFrom:   null,
  addAnnotationPin:  (pin) => set((s) => ({ annotationPins: [...s.annotationPins, pin] })),
  removeAnnotationPin: (id) => set((s) => ({
    annotationPins:  s.annotationPins.filter(p => p.id !== id),
    annotationLinks: s.annotationLinks.filter(l => l.fromId !== id && l.toId !== id),
  })),
  updateAnnotationPin: (id, patch) => set((s) => ({
    annotationPins: s.annotationPins.map(p => p.id === id ? { ...p, ...patch } : p),
  })),
  addAnnotationLink:  (link) => set((s) => ({ annotationLinks: [...s.annotationLinks, link] })),
  removeAnnotationLink: (id) => set((s) => ({
    annotationLinks: s.annotationLinks.filter(l => l.id !== id),
  })),
  updateAnnotationLink: (id, patch) => set((s) => ({
    annotationLinks: s.annotationLinks.map(l => l.id === id ? { ...l, ...patch } : l),
  })),
  setAnnotationTool:  (annotationTool) => set({ annotationTool, pendingLinkFrom: null }),
  setPendingPin:      (pendingPin) => set({ pendingPin }),
  setPendingLink:     (pendingLink) => set({ pendingLink }),
  setPendingLinkFrom: (pendingLinkFrom) => set({ pendingLinkFrom }),
  clearAnnotations:   () => set({ annotationPins: [], annotationLinks: [], pendingPin: null, pendingLink: null, pendingLinkFrom: null }),

  // i18n
  language:    'zh-TW',
  setLanguage: (language) => set({ language }),

  // Config modal
  showConfig:    false,
  setShowConfig: (showConfig) => set({ showConfig }),

  // Display
  uiScale:    1.0,
  setUiScale: (uiScale) => set({ uiScale }),

  // Scene time — deliberately NOT persisted. A reload should always land you
  // in the present; waking up scrubbed into the past with no memory of having
  // done it is the worst possible state for a monitoring tool.
  sceneTime: null,
  setSceneTime: (sceneTime) => set({ sceneTime }),
  returnToLive: () => set({ sceneTime: null }),

  // Presentation — persisted in localStorage
  homeView: localStorage.getItem('argus-home-view') === 'solar' ? 'solar' : 'earth',
  setHomeView: (homeView) => {
    localStorage.setItem('argus-home-view', homeView)
    set({ homeView })
  },
  // Defaults to the green-up convention, which is what the two largest
  // markets and every chart library assume.
  upColor: localStorage.getItem('argus-up-color') === 'red' ? 'red' : 'green',
  setUpColor: (upColor) => {
    localStorage.setItem('argus-up-color', upColor)
    set({ upColor })
  },
  decorativeFx: (() => {
    const saved = localStorage.getItem('argus-decorative-fx')
    if (saved !== null) return saved === 'true'
    // No stored preference: follow the OS accessibility setting.
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  })(),
  setDecorativeFx: (decorativeFx) => {
    localStorage.setItem('argus-decorative-fx', String(decorativeFx))
    set({ decorativeFx })
  },
  soundEnabled: localStorage.getItem('argus-sound-enabled') === 'true',
  setSoundEnabled: (soundEnabled) => {
    localStorage.setItem('argus-sound-enabled', String(soundEnabled))
    set({ soundEnabled })
  },
  nebulaIntensity: (() => {
    const v = parseFloat(localStorage.getItem('argus-nebula') ?? '')
    return isNaN(v) ? 1.2 : Math.min(2, Math.max(0, v))
  })(),
  setNebulaIntensity: (nebulaIntensity) => {
    localStorage.setItem('argus-nebula', String(nebulaIntensity))
    set({ nebulaIntensity })
  },
  soundVolume: (() => {
    const v = parseFloat(localStorage.getItem('argus-sound-volume') ?? '')
    return isNaN(v) ? 0.6 : Math.min(1, Math.max(0, v))
  })(),
  setSoundVolume: (soundVolume) => {
    localStorage.setItem('argus-sound-volume', String(soundVolume))
    set({ soundVolume })
  },
  // Open unless the reader has said otherwise: someone who has never met the
  // agent should meet it, and someone who has closed it once meant it.
  agentSectionOpen: localStorage.getItem('argus-agent-section-open') !== 'false',
  setAgentSectionOpen: (agentSectionOpen) => {
    localStorage.setItem('argus-agent-section-open', String(agentSectionOpen))
    set({ agentSectionOpen })
  },

  // HUD chrome level
  hudMode:     'full',
  prevHudMode: 'full',
  setHudMode:  (hudMode) => set((s) => ({
    hudMode,
    // Immersive is never somewhere to come back to.
    prevHudMode: hudMode === 'immersive' ? s.prevHudMode : hudMode,
  })),
  toggleImmersive: () => set((s) => s.hudMode === 'immersive'
    ? { hudMode: s.prevHudMode }
    : { hudMode: 'immersive', prevHudMode: s.hudMode }),

  // Popout
  poppedOut:    {},
  setPoppedOut: (key, v) => set((s) => ({ poppedOut: { ...s.poppedOut, [key]: v } })),

  // Category filter
  hiddenCategories: [],
  toggleHiddenCategory: (cat) => set((s) => ({
    hiddenCategories: s.hiddenCategories.includes(cat)
      ? s.hiddenCategories.filter((c) => c !== cat)
      : [...s.hiddenCategories, cat],
  })),

  timeRangeFilter: DEFAULT_TIME_RANGE,
  setTimeRangeFilter: (timeRangeFilter) => set({ timeRangeFilter }),

  // Full-text search
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  // Event sort order
  eventSortOrder: 'newest' as const,
  setEventSortOrder: (eventSortOrder) => set({ eventSortOrder }),

  // Event notes — persisted in localStorage
  eventNotes: (() => {
    try { return JSON.parse(localStorage.getItem('argus-event-notes') ?? '{}') as Record<string, string> }
    catch { return {} }
  })(),
  setEventNote: (id, note) => set((s) => {
    const next = { ...s.eventNotes }
    if (note.trim()) next[id] = note.slice(0, 500)
    else delete next[id]
    localStorage.setItem('argus-event-notes', JSON.stringify(next))
    return { eventNotes: next }
  }),

  // Filter presets — persisted in localStorage
  filterPresets: (() => {
    try { return JSON.parse(localStorage.getItem('argus-filter-presets') ?? '[]') as FilterPreset[] }
    catch { return [] }
  })(),
  saveFilterPreset: (name) => set((s) => {
    if (s.filterPresets.length >= 5) return s
    const preset: FilterPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: name.trim().slice(0, 30) || 'Preset',
      hiddenCategories: [...s.hiddenCategories],
      timeRangeFilter: s.timeRangeFilter,
      searchQuery: s.searchQuery,
    }
    const next = [...s.filterPresets, preset]
    localStorage.setItem('argus-filter-presets', JSON.stringify(next))
    return { filterPresets: next }
  }),
  applyFilterPreset: (id) => set((s) => {
    const p = s.filterPresets.find((fp) => fp.id === id)
    if (!p) return s
    return {
      hiddenCategories: [...p.hiddenCategories],
      timeRangeFilter:  p.timeRangeFilter,
      searchQuery:      p.searchQuery,
    }
  }),
  deleteFilterPreset: (id) => set((s) => {
    const next = s.filterPresets.filter((fp) => fp.id !== id)
    localStorage.setItem('argus-filter-presets', JSON.stringify(next))
    return { filterPresets: next }
  }),

  // Bookmarks — persisted in localStorage
  bookmarkedIds: (() => {
    try { return JSON.parse(localStorage.getItem('argus-bookmarks') ?? '[]') as string[] }
    catch { return [] }
  })(),
  toggleBookmark: (id) => set((s) => {
    const next = s.bookmarkedIds.includes(id)
      ? s.bookmarkedIds.filter((b) => b !== id)
      : [...s.bookmarkedIds, id]
    localStorage.setItem('argus-bookmarks', JSON.stringify(next))
    return { bookmarkedIds: next }
  }),
  showWatchlistOnly: false,
  setShowWatchlistOnly: (showWatchlistOnly) => set({ showWatchlistOnly }),

  // Intel brief
  intelBrief:    null,
  setIntelBrief: (b) => set((s) => ({
    intelBrief: b,
    briefRead: false,
    intelBriefHistory: [b, ...s.intelBriefHistory.filter(h => h.id !== b.id)].slice(0, 5),
  })),
  briefRead:     false,
  setBriefRead:  (briefRead) => set({ briefRead }),
  intelBriefHistory: [],

  // Person panel
  selectedEntities: [],
  addSelectedEntity: (p) => set((s) => {
    if (s.selectedEntities.some(e => e.name === p.name)) return s
    const panelZ = { ...s.panelZ, person: Math.max(...Object.values(s.panelZ), 29) + 1 }
    return { selectedEntities: [...s.selectedEntities, p], panelZ }
  }),
  removeSelectedEntity: (name) => set((s) => ({
    selectedEntities: s.selectedEntities.filter(p => p.name !== name),
  })),
  clearSelectedEntities: () => set({ selectedEntities: [] }),

  // Multi-entity context panel — the collected entities survive a reload the
  // way notes and filter presets do. A basket you assembled over several
  // minutes should not evaporate because the tab refreshed.
  contextEntities: loadContextEntities(),
  showContextPanel: false,
  setShowContextPanel: (showContextPanel) => set({ showContextPanel }),

  // Prediction panel — not persisted, unlike the collection above. It holds no
  // state a reader assembled: closing it discards nothing, and reopening it
  // reads the same live prices over again.
  // The panel re-reads on a one-minute timer, which is right for prices that
  // drift and wrong for a source that was just changed: settings would appear
  // to do nothing for up to a minute after an explicit action. This is the
  // nudge, and deliberately a counter rather than a callback — the panel need
  // not exist for the setting to be changed.
  predictionEpoch: 0,
  bumpPredictionEpoch: () => set((s) => ({ predictionEpoch: s.predictionEpoch + 1 })),

  showPredictionPanel: false,
  setShowPredictionPanel: (showPredictionPanel) => set((s) => ({
    showPredictionPanel,
    panelZ: showPredictionPanel
      ? { ...s.panelZ, prediction: Math.max(...Object.values(s.panelZ), 29) + 1 }
      : s.panelZ,
  })),
  addContextEntity: (entity) => set((s) => {
    if (s.contextEntities.some(e => e.id === entity.id)) return s
    if (s.contextEntities.length >= CONTEXT_ENTITY_LIMIT) return s
    const contextEntities = [...s.contextEntities, entity]
    persistContextEntities(contextEntities)
    return {
      contextEntities,
      // Always open. This used to open only when the list had been empty,
      // which meant that once the operator closed the panel, adding more
      // entities silently did nothing and there was no way back to it —
      // the add buttons for entities already collected are disabled, so the
      // feature became unreachable until a page reload.
      showContextPanel: true,
      panelZ: { ...s.panelZ, context: Math.max(...Object.values(s.panelZ), 29) + 1 },
    }
  }),
  removeContextEntity: (id) => set((s) => {
    const contextEntities = s.contextEntities.filter(e => e.id !== id)
    persistContextEntities(contextEntities)
    return { contextEntities }
  }),
  clearContextEntities: () => {
    persistContextEntities([])
    return set({ contextEntities: [], showContextPanel: false })
  },

  // Panel z-order — each call gives the clicked panel the current highest z
  panelZ:       { event: 30, region: 31, body: 32, canvasAnalysis: 33, person: 34, context: 35 },
  bringToFront: (key) => set((s) => {
    const max = Math.max(...Object.values(s.panelZ), 29)
    return { panelZ: { ...s.panelZ, [key]: max + 1 } }
  }),
}))
