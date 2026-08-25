/**
 * EventPanel — orchestration shell.
 *
 * Responsibilities:
 *  • Drag / position — via usePanelDrag
 *  • SVG tail line   — via PanelTail
 *  • Slide animation when navigating the timeline
 *  • Merges current event into the sorted timeline list
 *  • Delegates rendering to EventTimeline + EventPanelBody
 */
import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation }     from 'react-i18next'

import { useAppStore }        from '../../store'
import { categoryQueries }    from '../../lib/suggestedQueries'
import { eventContextEntity } from '../../lib/contextEntity'
import { useAgentQuery }      from '../../hooks/useAgentQuery'
import { usePopoutWindow }    from '../../hooks/usePopoutWindow'
import { useRelatedEvents }   from '../../hooks/useRelatedEvents'
import { usePanelDrag }       from '../../hooks/usePanelDrag'
import { copyToClipboard } from '../../utils/clipboard'
import { severityColor, categoryGlyph, categoryLabel } from '../../data/symbology'
import { EventTimeline }      from './EventTimeline'
import { EventPanelBody }     from './EventPanelBody'
import { Panel }              from './Panel'
import { PanelTail }          from './PanelTail'
import { eventSummary }       from '../../lib/eventText'
import { resolveOrbitalPlacement } from '../../data/orbitalPlacement'
import type { ArgusEvent, CelestialBodyName } from '../../types'


/** Coordinates are resolved and persisted server-side, so an event either has
 *  a point to fly to or names no point at all. */
function resolveEventLatLng(ev: ArgusEvent): { lat: number; lng: number } | null {
  if (ev.lat !== null && ev.lng !== null) return { lat: ev.lat, lng: ev.lng }
  return null
}

type FocusTarget =
  | { kind: 'surface'; lat: number; lng: number }
  | { kind: 'body'; body: CelestialBodyName }

/**
 * Where the focus control should send the camera.
 *
 * Off-Earth events go through the same resolver the marker layer uses. Reading
 * `event.body` directly does not work: the model writes prose ("Mars", "Saturn's
 * B Ring") while the body table is keyed by lowercase ids, so a Mars event drew
 * its marker correctly and then focused on nothing at all. The cast that used to
 * sit here — `event.body as CelestialBodyName` — is what let that compile.
 *
 * Deep-space events return null deliberately. They have no ephemeris position,
 * so the marker layer parks them at a fixed point rather than anchoring them to
 * a body, and there is nothing for the camera to fly to.
 */
export function resolveFocusTarget(ev: ArgusEvent): FocusTarget | null {
  if (ev.lat !== null && ev.lng !== null) return { kind: 'surface', lat: ev.lat, lng: ev.lng }

  const placement = resolveOrbitalPlacement(ev.body, ev.location_label)
  if (placement?.kind === 'body')       return { kind: 'body', body: placement.body }
  // Satellites, launches and stations ride above Earth; Earth is the anchor.
  if (placement?.kind === 'earthOrbit') return { kind: 'body', body: 'earth' }
  return null
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EventPanel() {
  const { t, i18n }         = useTranslation()
  const activePanelId       = useAppStore((s) => s.activePanelId)
  const events              = useAppStore((s) => s.events)
  const setActivePanelId    = useAppStore((s) => s.setActivePanelId)
  const goBack              = useAppStore((s) => s.goBack)
  const focusOnEarthSurface = useAppStore((s) => s.focusOnEarthSurface)
  const focusOn             = useAppStore((s) => s.focusOn)
  const setSelectedCountry  = useAppStore((s) => s.setSelectedCountry)
  const bookmarkedIds       = useAppStore((s) => s.bookmarkedIds)
  const toggleBookmark      = useAppStore((s) => s.toggleBookmark)
  const addContextEntity    = useAppStore((s) => s.addContextEntity)
  const contextEntities     = useAppStore((s) => s.contextEntities)

  // ── Drag / position ────────────────────────────────────────────────────────
  const { panelRef, pos, dragging, onHeaderMouseDown, zIndex, handleBringToFront, uiScale } =
    usePanelDrag({
      panelKey:   'event',
      defaultPos: {
        x: Math.max(20, window.innerWidth  - 380),
        y: Math.max(80, window.innerHeight - 600),
      },
    })

  const [hovered, setHovered] = useState(false)

  const { open: popoutOpen, isPopped } = usePopoutWindow('event')
  // Keyed on the event being shown: stepping through the timeline is a change
  // of subject, so the transcript starts fresh with each one. Keyed on the
  // active id rather than the displayed one, which lags behind it for the
  // length of the slide animation.
  const { history: agentHistory, loading: agentLoading, error: agentError, ask: agentAsk } =
    useAgentQuery(activePanelId ?? undefined)
  const { events: relatedEvents, loading: relatedLoading } = useRelatedEvents(activePanelId)

  // ── Timeline open/close ────────────────────────────────────────────────────
  const [timelineOpen, setTimelineOpen] = useState(true)

  // ── Agent ──────────────────────────────────────────────────────────────────
  const [agentInput, setAgentInput] = useState('')
  const agentScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    agentScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [agentHistory])

  // ── Current event (always from activePanelId) ──────────────────────────────
  const event = events.find((e) => e.id === activePanelId)

  // ── Merged timeline: current event + related, sorted newest-first ──────────
  const relatedIdsKey = useMemo(() => relatedEvents.map((e) => e.id).join(','), [relatedEvents])
  const allTimelineEvents = useMemo<ArgusEvent[]>(() => {
    if (!event) return relatedEvents
    const dedupd = relatedEvents.some((e) => e.id === event.id)
      ? relatedEvents
      : [event, ...relatedEvents]
    return [...dedupd].sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0
      return tb - ta
    })
    // Keyed on identity rather than on the arrays themselves, deliberately. The
    // store hands out a new `events` array on every arrival, and re-sorting the
    // timeline on each one would be work for nothing, since only the *set* of
    // events affects the order. The cost is that an event edited in place —
    // a heat score boosted by the retention pass, say — keeps its old object in
    // this list until the set changes. Rows can therefore be a few minutes
    // stale in their numbers; they are never the wrong events.
  }, [relatedIdsKey, event?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const allTimelineEventsRef = useRef(allTimelineEvents)
  allTimelineEventsRef.current = allTimelineEvents

  // ── Slide animation state ──────────────────────────────────────────────────
  const [displayedEventId, setDisplayedEventId] = useState(activePanelId)
  const [slideDir,         setSlideDir]          = useState<'up' | 'down'>('down')
  const [outgoingEvent,    setOutgoingEvent]      = useState<ArgusEvent | null>(null)
  const [copied,           setCopied]             = useState(false)
  const displayedEventIdRef = useRef(displayedEventId)
  displayedEventIdRef.current = displayedEventId
  const isFirstNavRef    = useRef(true)
  const eventsRef        = useRef(events)
  eventsRef.current      = events
  const pendingDirRef    = useRef<'up' | 'down'>('down')

  useEffect(() => {
    if (!activePanelId) return
    if (isFirstNavRef.current) { isFirstNavRef.current = false; setDisplayedEventId(activePanelId); return }
    if (activePanelId === displayedEventIdRef.current) return
    const leaving = eventsRef.current.find((e) => e.id === displayedEventIdRef.current) ?? null
    setSlideDir(pendingDirRef.current)
    setOutgoingEvent(leaving)
    setDisplayedEventId(activePanelId)
  }, [activePanelId])

  const displayedEvent = events.find((e) => e.id === displayedEventId) ?? event

  const agentContext = useMemo(() => {
    if (!displayedEvent) return ''
    return [
      `Event: ${displayedEvent.title}`,
      `Category: ${displayedEvent.category}`,
      `Intensity: ${displayedEvent.intensity}`,
      `Location: ${displayedEvent.location_label ?? 'Unknown'}`,
      `Source: ${displayedEvent.source}`,
      (() => {
        const s = eventSummary(displayedEvent, i18n.language) || displayedEvent.content
        return s ? `Summary: ${s.slice(0, 300)}` : ''
      })(),
      displayedEvent.actors?.length ? `Actors: ${displayedEvent.actors.join(', ')}` : '',
      displayedEvent.lat !== null ? `Coordinates: ${displayedEvent.lat?.toFixed(3)}, ${displayedEvent.lng?.toFixed(3)}` : '',
    ].filter(Boolean).join('\n')
  }, [displayedEvent, i18n.language])

  const suggestedQueries = useMemo(
    () => displayedEvent ? categoryQueries(t, displayedEvent.category) : [],
    [displayedEvent, t],
  )

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportEvent = useCallback(() => {
    if (!displayedEvent) return
    const e = displayedEvent
    const md = [
      `# ${e.title}`, '',
      `**Category:** ${e.category.replace(/_/g, ' ')}  `,
      `**Intensity:** ${e.intensity}  `,
      `**Source:** ${e.source}  `,
      `**Published:** ${e.published_at ?? '—'}  `,
      e.location_label ? `**Location:** ${e.location_label}  ` : '',
      e.heat_score != null ? `**Heat Score:** ${e.heat_score.toFixed(2)}  ` : '',
      e.reliability ? `**Reliability:** ${e.reliability}  ` : '',
      '', e.content ? `## Summary\n\n${e.content}` : '',
      e.actors?.length ? `\n## Actors\n\n${e.actors.join(', ')}` : '',
      e.tags?.length   ? `\n## Tags\n\n${e.tags.join(', ')}`   : '',
      '', `## Source\n\n[${e.source}](${e.url})`,
    ].filter((l) => l !== null).join('\n').trim()
    void copyToClipboard(md).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) } })
  }, [displayedEvent])

  // ── Focus ──────────────────────────────────────────────────────────────────
  //
  // Reads `event`, never `displayedEvent`. The latter is animation state: it is
  // set to activePanelId from inside an effect, so for one commit after a
  // selection it still holds the event being slid *out*. Focusing on it sent
  // the camera to the previously selected event every time — the panel showed
  // one place and the globe flew to another, and the next selection would fly
  // to where this one should have gone. `event` is derived straight from
  // activePanelId in render, so it is never a step behind.
  function triggerFocus() {
    if (!event) return
    const target = resolveFocusTarget(event)
    if (!target) return
    if (target.kind === 'surface') focusOnEarthSurface?.(target.lat, target.lng)
    else                           focusOn?.(target.body)
  }
  // Keyed on the event's id rather than on activePanelId, so that selecting an
  // event whose row has not arrived in the store yet still focuses once it does
  // instead of being dropped.
  useEffect(() => { triggerFocus() }, [event?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Same resolver as triggerFocus, so the control cannot offer a focus it will
  // not perform — an enabled button that quietly does nothing is what a Mars
  // event used to get.
  const canFocus = !!(event && resolveFocusTarget(event))

  // ── SVG tail — reads via ref each rAF tick ─────────────────────────────────
  const eventRef   = useRef(event)
  eventRef.current = event
  const getEventLatLng = useCallback((): { lat: number; lng: number } | null => {
    const ev = eventRef.current
    if (!ev) return null
    return resolveEventLatLng(ev)
  }, [])

  if (!event) return null

  // Panel chrome is coloured by severity, not category — the frame's job is to
  // tell you how alarmed to be. Category is carried by the glyph in the header.
  const accentColor    = severityColor(displayedEvent?.intensity ?? event.intensity)
  const intensityColor = accentColor
  const hasTimeline    = relatedLoading || allTimelineEvents.length > 0

  const exitAnim  = outgoingEvent
    ? (slideDir === 'up' ? 'scrollUpExit 0.28s ease-in-out forwards' : 'scrollDownExit 0.28s ease-in-out forwards')
    : undefined
  const enterAnim = outgoingEvent
    ? (slideDir === 'up' ? 'scrollUpEnter 0.28s ease-in-out forwards' : 'scrollDownEnter 0.28s ease-in-out forwards')
    : undefined

  return (
    <>
      {/* ── SVG tail ── */}
      <PanelTail
        panelRef={panelRef}
        getLatLng={getEventLatLng}
        color={accentColor}
        zIndex={zIndex}
        filterId="tailGlowEvent"
      />

      {/* ── Outer positioning wrapper (flex row: timeline + card) ── */}
      <div
        ref={panelRef}
        onMouseDown={handleBringToFront}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position:   'fixed',
          left:       pos.x,
          top:        pos.y,
          zIndex,
          display:    'flex',
          flexDirection: 'row',
          cursor:     dragging ? 'grabbing' : 'default',
          transition: dragging ? 'none' : 'box-shadow 0.2s',
          boxShadow:  hovered
            ? `0 0 0 1px ${accentColor}30, 0 8px 32px rgba(0,0,0,0.7), 0 0 24px ${accentColor}18`
            : `0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,180,255,0.1)`,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize:   '12px',
        }}
      >
        {/* Left: main card via Panel base */}
        <Panel
          accentColor={accentColor}
          width={320}
          dragging={dragging}
          onHeaderMouseDown={onHeaderMouseDown}
          headerLeft={
            <span style={{
              fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase',
              fontWeight: 600, padding: '1px 5px', borderRadius: '2px',
              color: intensityColor,
              border: `1px solid ${intensityColor}40`,
              background: `${intensityColor}12`,
            }}>
              {displayedEvent?.intensity ?? event.intensity}
            </span>
          }
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontSize: '12px' }}>{categoryGlyph(displayedEvent?.category ?? event.category)}</span>
              {categoryLabel(displayedEvent?.category ?? event.category)}
            </span>
          }
          headerControls={
            <>
              {/* Add to context */}
              {displayedEvent && (() => {
                const inContext = contextEntities.some(e => e.id === displayedEvent.id)
                return (
                  <button
                    onClick={() => addContextEntity(eventContextEntity(displayedEvent, i18n.language))}
                    title={inContext ? 'Already in context' : 'Add to context panel'}
                    disabled={inContext}
                    style={{
                      background: inContext ? 'rgba(0,255,204,0.12)' : 'none',
                      border: `1px solid ${inContext ? 'rgba(0,255,204,0.4)' : 'transparent'}`,
                      borderRadius: '2px',
                      color: inContext ? '#00ffcc' : '#4a6070',
                      cursor: inContext ? 'default' : 'pointer',
                      fontSize: '11px', lineHeight: 1,
                      padding: '1px 4px', transition: 'all 0.15s',
                      fontFamily: 'JetBrains Mono, monospace',
                      opacity: inContext ? 0.6 : 1,
                    }}
                  >{inContext ? '⊕' : '⊕'}</button>
                )
              })()}
              {/* Bookmark toggle */}
              {event && (() => {
                const isBookmarked = bookmarkedIds.includes(event.id)
                return (
                  <button
                    onClick={() => toggleBookmark(event.id)}
                    title={isBookmarked ? 'Remove bookmark' : 'Bookmark this event'}
                    style={{
                      background: 'none', border: 'none',
                      color: isBookmarked ? '#ffd700' : '#4a6070',
                      cursor: 'pointer', fontSize: '11px', lineHeight: 1,
                      padding: '1px 3px', transition: 'color 0.15s',
                    }}
                  >{isBookmarked ? '★' : '☆'}</button>
                )
              })()}
              <button
                onClick={exportEvent}
                title="Export as Markdown"
                style={{
                  background:   copied ? 'rgba(57,255,138,0.12)' : 'none',
                  border:       copied ? '1px solid rgba(57,255,138,0.4)' : '1px solid transparent',
                  borderRadius: '2px',
                  color:        copied ? '#39ff8a' : '#4a6070',
                  cursor: 'pointer', fontSize: '11px', lineHeight: 1,
                  padding: '1px 5px', transition: 'all 0.15s',
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em',
                }}
              >{copied ? '✓' : '↓ MD'}</button>
              <button
                onClick={popoutOpen}
                title="Open in new window"
                style={{
                  background: 'none', border: 'none',
                  color: isPopped ? '#00d4ff' : '#4a6070',
                  cursor: 'pointer', fontSize: '10px', lineHeight: 1,
                  padding: '1px 3px', transition: 'color 0.15s',
                }}
              >⊡</button>
            </>
          }
          onClose={() => setActivePanelId(null)}
          style={{ flexShrink: 0, boxShadow: 'none' }}
        >
          {/* Animated body clip container.
              A column flex box, not a plain block, so that the height set here
              reaches the scroll area inside. The body asks for `height: 100%`,
              and a percentage against an auto-height ancestor resolves to auto
              — which is what the in-flow animation wrapper below used to be.
              The body then sized itself to its own content, its `overflow-y`
              never had anything to overflow, and everything past this height
              was simply cut off by the `hidden` here with no scrollbar to say
              so. Long events lost their agent chat entirely.

              The height stays fixed rather than fitting the content: this card
              sits in a flex row with the timeline strip and carries an SVG tail
              to a point on the globe, so a height that changed with each event
              would resize the strip and move the tail's anchor on every step
              through the timeline. */}
          <div style={{
            overflow: 'hidden', position: 'relative',
            display: 'flex', flexDirection: 'column',
            height: `calc(${80 / uiScale}vh - 5.6rem)`,
          }}>
            {/* Outgoing event — absolute overlay, exits. Pinned top *and*
                bottom so it keeps the card's height while it slides out
                instead of collapsing onto its own content. */}
            {outgoingEvent && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex', flexDirection: 'column',
                animation: exitAnim, pointerEvents: 'none', zIndex: 1,
              }}>
                <EventPanelBody
                  event={outgoingEvent}
                  accentColor={severityColor(outgoingEvent.intensity)}
                  onFocus={triggerFocus}
                  canFocus={false}
                  setSelectedCountry={setSelectedCountry}
                  agentHistory={[]}
                  agentLoading={false}
                  agentError={null}
                  agentInput=""
                  setAgentInput={() => {}}
                  suggestedQueries={[]}
                  agentContext=""
                  agentAsk={() => {}}
                  agentScrollRef={agentScrollRef}
                />
              </div>
            )}
            {/* Incoming event — in-flow, enters. `minHeight: 0` is what lets it
                shrink to the clip container instead of growing past it, which
                is the whole of the fix: the body inside can then be the thing
                that scrolls. */}
            <div
              onAnimationEnd={() => setOutgoingEvent(null)}
              style={{
                animation: enterAnim,
                flex: '1 1 auto', minHeight: 0,
                display: 'flex', flexDirection: 'column',
              }}
            >
              {displayedEvent && (
                <EventPanelBody
                  event={displayedEvent}
                  accentColor={accentColor}
                  onFocus={triggerFocus}
                  canFocus={canFocus}
                  onBack={goBack ?? undefined}
                  setSelectedCountry={setSelectedCountry}
                  agentHistory={agentHistory}
                  agentLoading={agentLoading}
                  agentError={agentError}
                  agentInput={agentInput}
                  setAgentInput={setAgentInput}
                  suggestedQueries={suggestedQueries}
                  agentContext={agentContext}
                  agentAsk={agentAsk}
                  agentScrollRef={agentScrollRef}
                />
              )}
            </div>
          </div>
        </Panel>

        {/* Right: timeline strip. Placed after the card in the markup as well as
            on screen, so reading order and tab order both reach the event before
            its history. */}
        {hasTimeline && (
          <EventTimeline
            events={allTimelineEvents}
            loading={relatedLoading}
            accentColor={accentColor}
            activeEventId={displayedEventId ?? ''}
            onSelect={(id) => {
              const sorted = allTimelineEventsRef.current
              const curIdx = sorted.findIndex((e) => e.id === (displayedEventIdRef.current ?? ''))
              const newIdx = sorted.findIndex((e) => e.id === id)
              pendingDirRef.current = (newIdx !== -1 && curIdx !== -1 && newIdx < curIdx) ? 'up' : 'down'
              setActivePanelId(id)
            }}
            isOpen={timelineOpen}
            onToggle={() => setTimelineOpen((o) => !o)}
          />
        )}
      </div>
    </>
  )
}
