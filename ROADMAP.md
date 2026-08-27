# ARGUS Roadmap

Strategic goals and milestone tracking for the ARGUS satellite/event tracker project.

---

## Phase A — Data Layer Completion

> Tracking layers and data quality; wire up existing architecture gaps.

- [x] **AIS Ship Tracking** — server proxy at `/api/tracking/ships` (aisstream.io, requires `AISSTREAM_API_KEY`); `useShipsLayer` hook; TrackingLayer renders ships; FloatDock button wired
- [x] **Heat Score UI Visualization** — EventPanelBody shows colored heat bar + score + expiry label; EventStack tooltip shows heat score badge
- [x] **Event Source Reliability** — `reliability` field (HIGH/MEDIUM/LOW/UNVERIFIED) added to DB schema, Ollama prompt, client types, and EventPanelBody badge

---

## Phase B — User Experience

> Improve interaction detail and operational efficiency.

- [x] **Timeline Filter Slider** — `timeRangeFilter` ('6h'|'12h'|'24h'|'all') in Zustand store; segmented button group in CategoryFilterBar; EventStack filters by published_at
- [x] **Event Density Clustering** — 3-tier zoom system; greedy haversine clustering; ClusterMarker component with count badge; clicking opens highest-intensity event
- [x] **High-Intensity Toast Notifications** — ToastContainer detects new CRITICAL/HIGH events; auto-dismiss 3s; stacking bottom-right; slide-out animation
- [x] **Region Comparison Panel** — compare toggle in RegionPanel header; dual-column CompareCard with category breakdown and recent events; exits on ✕
- [x] **i18n Complete Coverage** — 40+ keys in en.json / zh-TW.json; all major UI strings keyed; language switch updates panel and toolbar labels

---

## Phase C — Advanced Analysis

> Deeper intelligence reasoning on top of existing Agent capabilities.

- [x] **Dynamic Conflict Front Layer** — multi-source GeoJSON registry (`CONFLICT_SOURCES`, built-in ISW preset); `/api/conflict/fronts` merges sources in parallel with a per-source 24h cache; ConflictLayer renders line/polygon/point features; FloatDock ⚔ toggle
- [x] **Event Relationship Graph** — SVG force-directed graph in EventPanelBody; color-coded nodes by category; clicking node navigates to related event
- [x] **Periodic Intelligence Summary** — 30-min server cron; top-5 heat-score events → Ollama → `intel_brief` Socket.io event; FloatDock BRIEF badge + modal
- [x] **Event Export / Share** — Export button in EventPanel header; Markdown + JSON modes; copy to clipboard with "Copied!" confirmation

---

## Phase D — Search & Discovery

> Make it fast and natural to find specific events and patterns.

- [x] **Full-Text Event Search** — ⌕ input in CategoryFilterBar; filters by title / content / actors / tags; ✕ clear; i18n
- [x] **Actor/Tag Drill-Down** — actor chips → buttons setting searchQuery; tags section added to EventPanelBody
- [x] **Event Cap Removal** — 45-item hard cap removed; window-based virtual scroll with ResizeObserver + wheel listener
- [x] **Bookmark / Watchlist** — ★/☆ in EventPanel header; ☆ toggle + count badge in filter bar; localStorage-persisted

---

## Phase E — Stability & Polish

> Code quality, persistence, and power-user ergonomics.

- [x] **Config Persistence** — persist llmConfig + feedsConfig to `server/data/config.json`; load on startup; atomic file write
- [x] **Shared Event Utilities** — extract `relativeTime()` + `heatColor()` from EventStack/EventPanelBody into `client/src/utils/eventUtils.ts`; filter logic into `useFilteredEvents` hook
- [x] **Globe Heatmap Overlay** — choropleth fill on GeoJsonLayer country polygons by event density/heat; FloatDock ⬡ HEAT toggle
- [x] **Keyboard Shortcuts** — Escape=close panel, /=focus search, b=bookmark, [/]=prev/next event

---

## Phase F — Resilience & Polish

> Harden edge cases, improve observability, and close remaining UX gaps.

- [x] **Panel Position Persistence** — `usePanelDrag` reads saved pos from `localStorage` on mount (bounds-clamped for window-resize safety); writes on change via `useEffect`
- [x] **Tracking Layer Error Feedback** — amber `!` badge on FloatDock layer buttons when fetch fails; clears on next success; error state in `usePoll` and `useConflictLayer`
- [x] **Loading States** — EventStack shows pulsing skeleton on first load; FloatDock layer buttons animate `loadingRing` while fetch is in-flight
- [x] **Agent Context Size Guard** — `MAX_CONTEXT_CHARS=8000` in `useAgentQuery`; truncated contexts prepend amber `.context-truncated-notice` HTML badge to response
- [x] **Keyboard Accessibility** — ArrowLeft/ArrowRight navigate filter chips; `aria-pressed` + `aria-label` on chips; global `:focus-visible` ring in CSS

---

## Phase G — Operational Hardening

> Improve operational stability, observability, and power-user workflows.

- [x] **Service Health Indicator** — `/api/health` returns ollamaOnline + lastScraperRun + analyzedCount; FloatDock shows amber badge when services degraded
- [x] **Intel Brief History** — rolling 5-brief history in Zustand; BRIEF modal shows collapsible past entries with timestamps
- [x] **Rate Limiting on Agent API** — per-IP token bucket (5 req/30s) on `/api/agent`; returns 429 when exceeded
- [x] **Config Modal Scraper Status** — per-feed health dots (green/red/grey) in Config Modal Feeds tab; server tracks success/error per feed
- [x] **Event Archive Export** — `GET /api/events/export?format=json|csv`; ConfigModal footer has ↓ JSON / ↓ CSV download links

---

## Phase H — Resilience & Real-Time Polish

> Improve live-data reliability and streaming robustness.

- [x] **Socket Reconnection Catch-Up** — on socket.io reconnect, re-fetch `/api/events`; FloatDock dot: green=connected, amber-pulsing=disconnected
- [x] **Toast Notification Deduplication** — same-category arrivals merge into one toast with ×N badge; dismiss timer resets on each merge
- [x] **Streaming Cut-Off Notice** — `doneReceived` flag in useAgentQuery detects stream closed without `[DONE]`; appends amber italic notice to partial response

---

## Phase I — Robustness & Quality

> Prevent catastrophic failures, improve error messaging, and strengthen test coverage.

- [x] **React Error Boundaries** — `ErrorBoundary` class component wraps HUD + 5 panels; shows compact error card + RETRY button
- [x] **Clipboard Write Fallback** — `copyToClipboard()` utility tries Clipboard API then falls back to `execCommand('copy')`
- [x] **Hook Unit Tests** — 9 tests for `useFilteredEvents` (category/time/search/watchlist/combination) + 5 for `useAgentQuery` (truncation, streaming, error, clear); 43 total tests pass

---

## Phase J — Efficiency & Integration

> Reduce unnecessary resource usage and open ARGUS to external integrations.

- [x] **Page Visibility Polling Pause** — usePoll, useConflictLayer, useServiceHealth skip fetches when document.hidden; visibilitychange listener resumes on tab focus
- [x] **Webhook Event Ingestion** — `POST /api/events/webhook` with `X-Webhook-Key` auth; validates category/intensity; inserts directly and broadcasts via Socket.io
- [x] **Event Search Highlighting** — `highlightText()` utility wraps matched terms in `<mark class="search-highlight">`; applied in EventStack tooltips and EventPanelBody title
- [x] **Server Test Suite** — Vitest added to server; 10 passing tests covering rateLimiter (token bucket, window reset, key isolation) and healthTracker (snapshot, feed success/error)

---

## Phase K — Security & UX Polish

> Closing security gaps and refining user-facing interactions.

- [x] **Rate Limit /api/agent-vision** — same 5 req/30s per-IP token bucket applied to vision endpoint
- [x] **Custom Filter Presets** — up to 5 named presets (hiddenCategories + timeRange + search) persisted to localStorage; preset row in CategoryFilterBar
- [x] **Localize Toast Intensity Labels** — `event.intensity.{LOW,MODERATE,HIGH,CRITICAL}` i18n keys; ToastContainer uses t()
- [x] **Lightweight Ollama Health Ping** — HEAD `/api/tags` with 3s AbortSignal.timeout instead of full client.list()

---

## Phase L — Data & Workflow

> Enhance data workflows, personal productivity, and operator integration.

- [x] **Export Filtered Events** — `/api/events/export?ids=id1,id2` filters to specific events; ConfigModal shows filtered export links when active filters are present
- [x] **Personal Event Notes** — `eventNotes` in Zustand (localStorage); EventPanelBody shows collapsible inline textarea with SAVE/CLEAR/ESC; 500 char limit
- [x] **Webhook Curl Helper in Config Modal** — healthTracker exposes `webhookEnabled`; Config Modal right column shows curl example with "COPY CURL EXAMPLE" button
- [x] **Event Arrival Rate Sparkline** — 12-bar SVG histogram below FloatDock event feed button; normalised to peak height; updates with each event batch

---

## Phase M — Security Headers & UX Refinement

> Harden HTTP security posture and improve power-user discoverability.

- [x] **Security Headers (Helmet.js)** — helmet middleware added (CSP disabled for WebGL compatibility); X-Frame-Options/MIME-sniff/referrer headers active
- [x] **Keyboard Shortcuts Help Overlay** — `?` key / FloatDock `?` button opens `KeyboardShortcutsModal`; lists all 7 shortcuts
- [x] **User-Configurable Event Sort** — `eventSortOrder` in Zustand; CategoryFilterBar select (NEWEST/HEAT ↓/INTENSITY ↓); useFilteredEvents applies chosen sort
- [x] **IconItem React.memo Optimization** — `memo()` wrapper with custom comparator (event.id, isNew, nudgeGen, searchQuery) prevents unnecessary re-renders

---

## Phase N — Accessibility & Test Depth

> Improve keyboard/screen-reader accessibility and expand automated test coverage.

- [x] **Modal Focus Trapping** — `useFocusTrap` hook traps Tab/Shift+Tab within Config Modal, KeyboardShortcutsModal, and Intel Brief modal; `role="dialog"` + `aria-modal="true"` on all three; restores focus on close
- [x] **Panel ARIA Roles** — Panel.tsx base component adds `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (auto-generated via `useId()`) to all 5 floating panels (EventPanel, RegionPanel, PersonPanel, CelestialBodyPanel, MultiEntityContextPanel)
- [x] **Hook Integration Tests** — 7 tests for `useServiceHealth` (healthy/unhealthy states, stale scraper, fetch error, document.hidden, visibilitychange) + 8 tests for `useConflictLayer` (loading, success, error, disable/re-enable, document.hidden, visibilitychange); 58 client tests pass
- [x] **Server SQLite Integration Test** — 9 tests using in-memory SQLite DB covering `insertWebhookEvent` (insert, dedup, JSON actors/tags), `getRelatedEvents` (actor/tag/location overlap scoring), and `deleteExpiredArticles` (expiry conditions); 19 server tests pass

---

## Phase O — Security, Observability & Coverage

> Close API security gaps, improve server-side logging, and expand test coverage for critical paths.

- [x] **API Input Validation** — `server/src/utils/validation.ts` with 4 pure validators (export params, event id, llm config body, feeds body); 34 unit tests; all 5 affected routes updated
- [x] **Config Endpoint Auth** — optional `CONFIG_SECRET` env var; `validateConfigAuth()` in validation.ts; `checkConfigAuth()` guard on POST `/api/config/llm` and `/api/config/feeds`; 6 tests
- [x] **Structured Logging** — `server/src/utils/logger.ts` with `LOG_LEVEL` env var (debug/info/warn/error/silent); all 28 server `console.*` calls replaced; 7 logger tests; 66 server tests total
- [x] **Accessibility: Button aria-labels** — 10 interactive elements across 5 files (EventPanelBody, CategoryFilterBar, PersonPanel, RegionPanel, CelestialBodyPanel); icon-only buttons and sort `<select>` now have `aria-label`
- [x] **Test: useOllamaSocket hook** — 8 Vitest tests (initial fetch, eventsLoaded on failure, connect/disconnect state, new_event, deduplication, intel_brief, reconnect re-fetch, unmount); 67 client tests total
- [x] **Perf: Lazy-load i18n locale** — `i18next-http-backend` installed; locale JSON moved to `public/locales/{lng}/translation.json`; static imports removed from i18n/index.ts; only active locale fetched at startup

---

## Phase P — Deployment & Hardening

> Enable production self-hosting and close remaining operational gaps.

- [x] **Dockerfile + docker-compose** — Multi-stage Dockerfile (client Vite build → server tsc → lean production image); docker-compose.yml with named volume for SQLite + config persistence; Express serves React build in production mode; .env.example updated with all env vars
- [x] **GitHub Actions CI** — ci.yml with parallel client (Vitest + Vite build) and server (Vitest + tsc) jobs on Node 22; triggers on push/PR to main
- [x] **Rate limit webhook + export endpoints** — `checkRateLimit` applied to POST `/api/events/webhook` (10/60s) and GET `/api/events/export` (5/60s)
- [ ] **Server worker unit tests** — Vitest coverage for scraper.ts (feed dedup/hash) and summary.ts (prompt building, offline no-op); ≥8 new tests
- [ ] **Paginate /api/events** — optional `?limit=N&offset=M` params (default limit 500); validate limit ≤ 1000

---

## Phase Q — Prediction Markets

> Forward-looking market data for the events that have no listed instrument — elections, ceasefires, rate decisions, launch windows. Staged so that a mis-linked market is impossible before it is merely unlikely.

**Stage 1 — global watchlist (no matching, no linkage)**

- [x] **Prediction service** — `server/src/services/prediction.ts`, shaped after `market.ts`: `parseMarket` split from the fetch so shape judgement is testable without the network; every unexpected upstream response fails to "not shown" rather than to a placeholder number; `MAX_SLUGS` cap per call so one panel cannot fan out. Cache TTL 60s — the 10-minute close-feed TTL does not carry over, its justification was that the market is shut most of the time and this one trades 24/7. Confirm Gamma/CLOB paths against the live API before implementing
- [x] **Prediction endpoints** — `GET /api/prediction/markets` (no params serves the watchlist, `?slugs=` for the subset views to come) and `GET /api/prediction/history?slug=…&window=…`, both rate limited. No validators in `validation.ts` after all: those return 400, and the sibling quote routes answer a request they cannot serve with an empty reply instead — absence is the contract this panel is built on, and one route breaking it would be worse than the asymmetry. History takes a slug and resolves the CLOB token itself, off the market cache
- [x] **Curated slug list** — `server/src/config/predictionMarkets.ts`, hand-maintained in the same spirit as `feeds.ts`. Stage 1 ships this and nothing else: no model, no text similarity, no auto-matching. No matching means no mis-matching, and it also keeps distasteful markets (casualty counts, death pools) off screen by construction
- [x] **Volume floor** — `MIN_VOLUME_USD` enforced in the parse layer, not the view. A market with $400 of volume prices identically to a liquid one; this is the dormant-GDR failure again — a wrong number that renders perfectly — so the row is dropped rather than annotated
- [x] **Watchlist panel** — question text rendered verbatim (never paraphrased: resolution criteria are the whole difference between near-duplicate markets), priced percentage, 24h change, resolution date, volume. Every row carries its resolution date for the same reason every quote row carries its as-of date
- [x] **Wording: "market price", not "probability"** — fees, cost of capital and longshot bias mean the two are not the same claim; i18n keys in both locales. Sits alongside the event panel's existing refusal to assert causation
- [x] **Outbound market links** — each row links out to its Polymarket event page (`target="_blank" rel="noopener noreferrer"`, external-link affordance), so a reader can check resolution criteria and depth at the source. The boundary: link out, nothing more — no wallet, no in-app order flow, no trade affordance. Restate "not an investment tool" in this context
- [x] **Timeline integration** — `prices-history` backs the 24h scrub so prices rewind with the rest of the UI; unlike stock closes these have real intraday shape, so the rows stay visible in retrospect rather than hiding with the live-only layers. The daily move is recomputed for the scrubbed instant rather than carried over — a rewound price beside a live change is two numbers that cannot both be true. Series are fetched only once a reader actually scrubs, and the history route took `slugs` plural in the end: the scrub moves every row at once
- [x] **README + disclosure** — new row in 資料來源與授權 (Polymarket Gamma/CLOB, public read-only, no key); extend the privacy note — querying a market tells the upstream which event you are reading, same standing as Wikipedia and Yahoo
- [x] **Tests** — 69 in all: 30 on `parseMarket`/`parsePriceHistory` (shape guards, settled and expired markets, multi-outcome, degenerate prices, volume floor, YES-by-label), 22 on the display and rewind rules, 17 on the panel (verbatim question, points-not-percent, single outbound link, absence on failure, rewound prices). The routes have no test harness in this project and were exercised against a running server instead

**Stage 1b — two sources, chosen at runtime**

> Not planned. Polymarket turned out to be DNS-blocked in Taiwan and in other jurisdictions that treat it as gambling, so the panel Stage 1 built showed nothing there — and the block is at the ISP, not something a reader can switch off.

- [x] **Provider boundary** — `services/prediction.ts` became `services/prediction/{types,kalshi,polymarket,index}.ts`: providers fetch and parse, `index.ts` owns the cache, the concurrency limit and which source is in use. `PredictionMarket.slug` became `id` (a slug on one source, a ticker on the other, and neither name would be true of both) and `yesTokenId` became an opaque `historyKey`. What the two do not share is documented rather than flattened — most importantly `volumeUsd`, which is dollars matched on one source and contracts settling at a dollar each on the other, so the volume floor is per provider
- [x] **Kalshi provider, default** — every field checked against live responses, not documentation. A question is an *event* rather than a market there, which is what makes the multi-outcome guard possible: eight rival markets under one NATO question are each individually binary and would each have passed a per-market check. `mutually_exclusive` plus a market count catches them. The daily move is derived from candlesticks rather than read off `previous_price_dollars`, which states no period
- [x] **Verified watchlist** — 11 Kalshi events read off live responses: single-market, not mutually exclusive, trading, past the volume floor. The shape of the list is itself a finding — the exchange is deep on American politics and macro and had no Ukraine, Taiwan or Iran market among the single-outcome events, so `ARMED_CONFLICT` is represented by diplomatic normalisation. That gap is why the Polymarket provider is kept rather than deleted; its slugs remain UNVERIFIED
- [x] **Source setting** — `config/predictionConfig.ts` (persisted, `PREDICTION_PROVIDER` env default, invalid values rejected rather than reaching a lookup as undefined); `GET/POST /api/config/prediction`; a two-option control in ConfigModal beside the feeds, carrying the reason for choosing between them. Applying bumps a counter the panel watches, so switching does not appear to do nothing until the next one-minute refresh
- [x] **Two faults found by running it** — the daily move was empty on every row, measured from a window exactly as wide as the request that fed it; and half the history requests were being throttled under a sixteen-way fan-out, with the misses cached, stranding rows un-rewindable for five minutes over a hiccup. Neither was visible in the tests, because both parsers were given data
- [x] **README** — two-source table, per-source watchlists, the volume-unit difference, and a troubleshooting note: a blocked domain presents as a certificate error rather than a timeout, which reads as a broken upstream or a broken build

**Stage 2 — region panel**

> Planned as tag matching and delivered as a stated mapping, because the tags do not exist. Of Kalshi's 220 series tags exactly four are countries — Iran, Brazil, Hungary, Peru — incidentally rather than as a taxonomy. Matching country names against the question text was the alternative and reintroduces the failure this feature is shaped around, only smaller: Turkey, Chad, Jordan and Georgia are each a country and each something else.

- [x] **Region markets row** — `RegionMarkets.tsx` beside `RegionIndices`, on the same reasoning: it is a reading of a place rather than of something the reader clicked. Filters the watchlist the prediction panel has already fetched, so it costs no extra request
- [x] **Countries stated, not derived** — `WatchedMarket.countries`, written down beside each market and travelling with the row. Absent where a market is about no country: a Mars landing is not a reading of the United States, and filing it under the launching country would be the category error the index table records about sector indices
- [x] **No excluded-topic filter needed** — it was on this list because rows were to stop being hand-picked here. They do not: the mapping is as hand-maintained as the watchlist, so distasteful subjects stay out by construction rather than by filter
- [ ] **Verify in the running app** — the data path was checked live (11 rows, 6 countries, 2 deliberately untagged) and the component has unit coverage, but the panel itself was not opened: reaching a region panel needs either the WebGL globe, which does not render in the available browser pane, or a classified event to click through from

**Bounded by the watchlist, which is the scope of the whole feature.** Most countries render nothing here. Widening it to the exchange's full inventory means a matcher, and a matcher is Stage 3's problem to prove.

**Stage 3 — per-event linkage (gated on 1–2 holding up)**

- [ ] **Deterministic linkage, then measured** — candidate rule is resolution entity ∈ event actors AND time-window overlap AND volume floor, not a free-text model call: Polymarket's market space is open-ended, and `market_link` only stayed honest because its six values are a closed enum. Measure precision on a 200-article replay the way `relation` was measured, and delete the feature if it does not carry information rather than leaving it to look like a signal

---

## Completed

> Features fully implemented and stable.

- [x] Solar system 3D scene (30+ bodies, real orbital elements, textures)
- [x] Camera control system (scroll zoom, right-drag orbit, WASD pan, click-focus tween)
- [x] Real-time astronomical sync (revolution / rotation / GAST / day-night terminator)
- [x] Distance-aware interaction levels (solar → orbital → surface)
- [x] Celestial nav list (dynamic filter, satellite / asteroid / comet groups)
- [x] Earth LOD textures (8K / 2K auto-switch with hysteresis)
- [x] SQLite schema + 4 indexes + WAL mode
- [x] RSS scraper (URL-hash dedup, 15-min cron)
- [x] Ollama worker (JSON classification + heat_score init + expires_at tiering)
- [x] Heat score system (Retention Worker 15-min scan / three-condition delete)
- [x] WebSocket real-time push (Socket.io `new_event`)
- [x] Political GeoJSON layer (110m / 50m auto-switch by distance)
- [x] Event radar markers (category icon + color + pulse animation)
- [x] Aircraft tracking layer (ADS-B OpenSky + server cache)
- [x] Satellite tracking layer (TLE Celestrak + server cache)
- [x] Focus camera tween (smooth zoom, back-to-previous-view)
- [x] Region intel panel (flag / overview / stats / recent events / Wikipedia summary)
- [x] Event intel panel (type / summary / timeline / source list / intensity)
- [x] Agent chat (Ollama SSE stream + HTML whitelist render)
- [x] Agent Vision (AnnotationCanvas screenshot → multimodal Ollama analysis)
- [x] Suggested Queries auto-generation
- [x] Lite Mode (icon-dock sidebar collapse)
- [x] Immersive Mode (full-screen scene + FloatDock quick access)
- [x] CategoryFilterBar (category toggle filter for EventStack)
- [x] Config Modal (Ollama model / scrape interval / UI scale slider)
- [x] Panel Popout (separate window + BroadcastChannel sync)
- [x] Drag boundary clamping (panels cannot exceed viewport)
- [x] Annotation canvas (free-draw + Socket.io multi-client sync)
- [x] i18n foundation (i18next, EN / zh-TW)
- [x] Panel base component (Panel.tsx + usePanelDrag + PanelTail; EventPanel / RegionPanel / CelestialBodyPanel migrated)
- [x] Popout 2-column layout (usePopoutWindow full-screen; PopoutPage 60/40 split; PopoutAIPanel dedicated AI column)
- [x] Vitest + @testing-library/react setup; 9 Panel unit tests + 8 PersonPanel tests
- [x] PersonPanel — Wikipedia biography, thumbnail, multi-person cards, AI chat, search via Wikipedia API
- [x] Entity linking — extractPersonNames() + LinkedText in EventPanelBody / RegionPanelOverview / CelestialBodyPanel
- [x] PersonPanel popout — ⊡ button; person popout renders in 2-column layout with dedicated AI agent

---

## Recurring — UI/UX Optimization

> Standing task for every development cycle. Proactively identify and improve usability,
> visual consistency, accessibility, performance feel, and interaction polish across the app.

**Scope (non-exhaustive):**
- Visual inconsistencies (spacing, color, font-size mismatches between panels)
- Missing hover/focus/active states on interactive elements
- Accessibility gaps (keyboard navigation, ARIA labels, contrast)
- Scroll, animation, and transition jank
- Redundant re-renders or layout thrash visible to users
- Responsive layout issues at different viewport / uiScale values
- Empty-state and error-state polish (blank areas, raw error strings)
- i18n string gaps or untranslated labels
- Tooltip / title consistency across buttons and chips

**Process:** Each cycle, scan the current UI for low-hanging improvements, pick 1-3 items,
implement, verify no regressions, and log what was done in TASKS.md.
