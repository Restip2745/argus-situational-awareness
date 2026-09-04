/**
 * EventPanelBody — scrollable content for EventPanel.
 *
 * Renders everything below the drag-handle header:
 *   title · datetime · summary · actors · meta/location · source link
 *   · coordinates · focus button · back button · suggested queries · agent chat
 *
 * Receives all data as props so EventPanel can animate this whole block as
 * a unit (slide in/out) when the user navigates the timeline.
 */
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveCountryName } from '../../data/countryData'
import { EventCommodities } from './EventCommodities'
import { EventCompanies } from './EventCompanies'
import type { ArgusEvent } from '../../types'
import type { SelectedCountry } from '../../store'
import { useAppStore } from '../../store'
import { awaitingFirstToken, type AgentEntry } from '../../hooks/useAgentQuery'
import { AgentAnswerBlock } from './AgentAnswerBlock'
import { SubjectAddedNote } from './SubjectAddedNote'
import { linkableEntityNames, LinkedText } from '../../utils/entityLinker'
import { EntityGlyph } from './EntityGlyph'
import { relativeTime, heatColor } from '../../utils/eventUtils'
import { eventTitle, eventSummary } from '../../lib/eventText'
import { highlightText } from '../../utils/highlightText'
import { youtubeVideoId, youtubeEmbedUrl } from '../../utils/videoEmbed'
import { useSceneTime } from '../../hooks/useSceneTime'

function expiryLabel(expiresAt: string | null, heatScore: number, sceneNow: number): string {
  if (expiresAt) {
    const msLeft = new Date(expiresAt).getTime() - sceneNow
    if (msLeft <= 0) return 'EXPIRED'
    const h = Math.floor(msLeft / 3_600_000)
    if (h < 1) return `<1h`
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}d`
  }
  if (heatScore >= 1.5) return '7d'
  if (heatScore >= 1.0) return '3d'
  if (heatScore >= 0.5) return '48h'
  return '24h'
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  event:            ArgusEvent
  accentColor:      string
  onFocus:          () => void
  canFocus:         boolean
  onBack?:          () => void
  setSelectedCountry: (c: SelectedCountry) => void
  // Agent chat
  agentHistory:     AgentEntry[]
  agentLoading:     boolean
  agentError:       string | null
  agentInput:       string
  setAgentInput:    (v: string) => void
  suggestedQueries: string[]
  agentContext:     string
  agentAsk:         (q: string, ctx: string) => void
  agentScrollRef:   React.RefObject<HTMLDivElement>
  /** When true, the embedded agent section is hidden (e.g. in popout where AI is a separate column). */
  hideAgent?:       boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EventPanelBody({
  event, accentColor,
  onFocus, canFocus, onBack,
  setSelectedCountry,
  agentHistory, agentLoading, agentError,
  agentInput, setAgentInput,
  suggestedQueries, agentContext, agentAsk,
  agentScrollRef,
  hideAgent = false,
}: Props) {
  const { t, i18n } = useTranslation()
  const { now: sceneNow } = useSceneTime()
  const agentSectionOpen    = useAppStore((s) => s.agentSectionOpen)
  const setAgentSectionOpen = useAppStore((s) => s.setAgentSectionOpen)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const searchQuery    = useAppStore((s) => s.searchQuery)
  const eventNotes     = useAppStore((s) => s.eventNotes)
  const setEventNote   = useAppStore((s) => s.setEventNote)
  const existingNote   = eventNotes[event.id] ?? ''
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // Video events show a play facade over the thumbnail; the iframe is mounted
  // only once the user asks for it, so an unwatched panel makes no request to
  // Google. Keyed off event.id so navigating the timeline resets to the facade
  // rather than leaving the previous video playing under a new headline.
  const videoId = youtubeVideoId(event.url)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const isPlaying = playingId === event.id

  function openNote() {
    setNoteDraft(existingNote)
    setNoteOpen(true)
    setTimeout(() => { noteRef.current?.focus(); noteRef.current?.select() }, 30)
  }

  function saveNote() {
    setEventNote(event.id, noteDraft)
    setNoteOpen(false)
  }
  const addSelectedEntity = useAppStore((s) => s.addSelectedEntity)
  const linkableNames = linkableEntityNames(event.actors ?? [])

  // ── Agent section: collapsed / expanded ────────────────────────────────────
  //
  // Seeded from the stored preference and kept locally afterwards, so stepping
  // through the timeline does not re-decide it on every event. Toggling writes
  // through to the preference: closing the agent is a statement about the agent,
  // not about this one article.
  const [agentOpen, setAgentOpen] = useState(agentSectionOpen)
  function toggleAgent() {
    const next = !agentOpen
    setAgentOpen(next)
    setAgentSectionOpen(next)
  }

  // Asking opens the section without touching the preference — an answer the
  // reader cannot see is worse than a long panel, and the suggested-query
  // buttons sit outside this section and can be pressed while it is shut.
  function askAgent(q: string, ctx: string) {
    setAgentOpen(true)
    agentAsk(q, ctx)
  }

  const title = eventTitle(event, i18n.language)
  // The generated summary in the reader's language; the raw RSS snippet is the
  // fallback for anything ingested before summaries existed, or not translated.
  const summary = eventSummary(event, i18n.language) || event.content || null

  // Opening the country panel flies the camera somewhere, so the link is only
  // offered when the event has a position to fly to. Events whose label names
  // an area rather than a point ("Europe", "Global Tech Sector") have none.
  function resolveCountry() {
    const label = event.location_label
    if (!label || label === '—') return null
    if (event.lat === null || event.lng === null) return null
    return { label, countryKey: resolveCountryName(label) }
  }

  const countryInfo = resolveCountry()

  function handleOpenCountry() {
    if (!countryInfo) return
    const { label, countryKey } = countryInfo
    // The server has already resolved the label to a centroid where one
    // exists, so event.lat/lng is the best position available.
    if (event.lat === null || event.lng === null) return
    setSelectedCountry({ name: countryKey ?? label, lat: event.lat, lng: event.lng })
  }

  function hostname() {
    try { return new URL(event.url).hostname.replace('www.', '') }
    catch { return event.source }
  }

  return (
    // `flex` + `minHeight: 0` for the panel, where this is a flex item in a
    // height-capped column and must be allowed to shrink below its content for
    // `overflow-y` to mean anything. `height: 100%` for the popout, where the
    // parent is an ordinary block of definite height. Both are needed: the two
    // callers size this differently.
    <div style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0, height: '100%', scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,180,255,0.15) transparent' }}>

      {/* ── Thumbnail image · doubles as the video player for video events ──── */}
      {(event.image_url || (videoId && isPlaying)) && (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', overflow: 'hidden', borderBottom: `1px solid ${accentColor}18` }}>
          {videoId && isPlaying ? (
            <iframe
              src={youtubeEmbedUrl(videoId)}
              title={title}
              allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            />
          ) : (
            <>
              <img
                src={event.image_url ?? undefined}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }}
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  filter: 'brightness(0.82) saturate(0.85)',
                }}
              />
              <div style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(to bottom, transparent 50%, rgba(10,18,26,0.85) 100%)`,
                pointerEvents: 'none',
              }} />
              {videoId && (
                <button
                  onClick={() => setPlayingId(event.id)}
                  aria-label={t('event.playVideo', 'Play video')}
                  style={{
                    // Deliberately only the dial, not a full-bleed overlay: a
                    // click that opens the panel can land where the thumbnail
                    // appears, and a cover-everything target would start the
                    // video — the one thing the facade exists to prevent.
                    position: 'absolute', top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '44px', height: '44px', borderRadius: '50%',
                    background: 'rgba(10,18,26,0.72)',
                    border: `1px solid ${accentColor}`,
                    color: accentColor,
                    fontSize: '15px', lineHeight: 1, paddingLeft: '3px',
                    cursor: 'pointer',
                  }}
                >▶</button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Main info ──────────────────────────────────────────────────────── */}
      <div className="relative px-3 py-3 space-y-2.5">
        {/* Lead — the one thing read first, so it gets the lead tier (13px). */}
        <h2 className="text-[#dce9f2] text-[13px] font-semibold leading-snug">{highlightText(title, searchQuery)}</h2>

        {/* Personal note */}
        {!noteOpen && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
            {existingNote ? (
              <button
                onClick={openNote}
                style={{ fontSize: '10px', color: '#4a6070', textAlign: 'left', background: 'rgba(0,180,255,0.04)', border: '1px solid rgba(0,180,255,0.1)', borderRadius: '2px', padding: '2px 6px', cursor: 'pointer', maxWidth: '100%', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.4 }}
                title={t('note.editHint')}
              >
                ✏ {existingNote.slice(0, 80)}{existingNote.length > 80 ? '…' : ''}
              </button>
            ) : (
              <button
                onClick={openNote}
                style={{ fontSize: '10px', color: '#2a4060', letterSpacing: '0.08em', background: 'none', border: '1px solid rgba(0,180,255,0.08)', borderRadius: '2px', padding: '2px 6px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}
              >{t('note.add')}</button>
            )}
          </div>
        )}
        {noteOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <textarea
              ref={noteRef}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value.slice(0, 500))}
              onKeyDown={(e) => { if (e.key === 'Escape') { setNoteOpen(false) } if (e.key === 'Enter' && e.ctrlKey) saveNote() }}
              placeholder={t('note.placeholder')}
              rows={3}
              style={{ fontSize: '11px', color: '#a8c4d8', background: 'rgba(0,180,255,0.04)', border: '1px solid rgba(0,180,255,0.2)', borderRadius: '3px', padding: '5px 7px', resize: 'vertical', fontFamily: 'JetBrains Mono, monospace', outline: 'none', lineHeight: 1.5, width: '100%' }}
            />
            <div style={{ display: 'flex', gap: '4px', fontSize: '10px' }}>
              <button onClick={saveNote} style={{ color: '#00d4ff', background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.3)', borderRadius: '2px', padding: '2px 8px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>{t('note.save')}</button>
              {existingNote && <button onClick={() => { setNoteDraft(''); saveNote() }} style={{ color: '#ff4d4d', background: 'none', border: '1px solid rgba(255,77,77,0.25)', borderRadius: '2px', padding: '2px 8px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>{t('note.clear')}</button>}
              <button onClick={() => setNoteOpen(false)} style={{ color: '#2a4060', background: 'none', border: '1px solid rgba(0,180,255,0.1)', borderRadius: '2px', padding: '2px 8px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>{t('note.esc')}</button>
              <span style={{ color: '#1a3050', marginLeft: 'auto', letterSpacing: '0.06em' }}>{noteDraft.length}/500</span>
            </div>
          </div>
        )}

        {/* Datetime */}
        {event.published_at && (
          <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: '#2a4060' }}>
            <span style={{ color: accentColor + '99' }}>{relativeTime(event.published_at)}</span>
            <span style={{ color: '#1a3050' }}>·</span>
            <span>
              {new Date(event.published_at).toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
        )}

        {/* The lead image is the 16:9 banner at the top of the panel. A second
            copy used to sit here, so every article with artwork showed it
            twice. */}

        {/* Substance, not chrome — must not be dimmer or smaller than the
            labels around it. */}
        {summary && (
          <p className="text-[#8aabbf] text-[11px] leading-relaxed">
            <LinkedText
              text={summary}
              knownEntities={linkableNames}
              onEntityClick={addSelectedEntity}
            />
          </p>
        )}

        {/* Actors — click to filter EventStack by actor name */}
        {event.actors?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {event.actors.map(a => {
              const isLinkable = linkableNames.includes(a)
              return (
                <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: '1px' }}>
                  <button
                    onClick={() => setSearchQuery(a)}
                    title={`Filter events by "${a}"`}
                    className="px-1.5 py-0.5 text-[11px] rounded transition-all"
                    style={{
                      background: `${accentColor}10`,
                      border: `1px solid ${accentColor}30`,
                      color: accentColor + 'cc',
                      cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace',
                      borderRadius: isLinkable ? '2px 0 0 2px' : '2px',
                    }}
                    onMouseEnter={e => { const el = e.currentTarget; el.style.background = `${accentColor}22`; el.style.borderColor = `${accentColor}70`; el.style.color = accentColor }}
                    onMouseLeave={e => { const el = e.currentTarget; el.style.background = `${accentColor}10`; el.style.borderColor = `${accentColor}30`; el.style.color = accentColor + 'cc' }}
                  >
                    {a}
                  </button>
                  {isLinkable && (
                    <button
                      onClick={() => addSelectedEntity({ name: a, wikiTitle: a })}
                      title={`View entity: ${a}`}
                      className="py-0.5 text-[10px] transition-all"
                      style={{
                        background: '#c084fc10',
                        border: '1px solid #c084fc30',
                        borderLeft: 'none',
                        color: '#c084fccc',
                        cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace',
                        borderRadius: '0 2px 2px 0',
                        padding: '1px 4px',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#c084fc22'; e.currentTarget.style.color = '#c084fc' }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#c084fc10'; e.currentTarget.style.color = '#c084fccc' }}
                    >
                      <EntityGlyph name={a} />
                    </button>
                  )}
                </span>
              )
            })}
          </div>
        )}

        {/* Tags — click to filter EventStack by tag */}
        {event.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {event.tags.map(tag => (
              <button
                key={tag}
                onClick={() => setSearchQuery(tag)}
                title={`Filter events by "${tag}"`}
                className="px-1.5 py-0.5 text-[11px] rounded transition-all"
                style={{
                  background: 'rgba(0,180,255,0.05)',
                  border: '1px solid rgba(0,180,255,0.18)',
                  color: '#2a6080',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                  letterSpacing: '0.04em',
                }}
                onMouseEnter={e => { const el = e.currentTarget; el.style.background = 'rgba(0,180,255,0.12)'; el.style.borderColor = 'rgba(0,180,255,0.45)'; el.style.color = '#00d4ff' }}
                onMouseLeave={e => { const el = e.currentTarget; el.style.background = 'rgba(0,180,255,0.05)'; el.style.borderColor = 'rgba(0,180,255,0.18)'; el.style.color = '#2a6080' }}
              >
                # {tag}
              </button>
            ))}
          </div>
        )}

        {/* Commodity exposure — renders nothing for almost every event */}
        {event.market_link && event.market_link.length > 0 && (
          <EventCommodities
            commodities={event.market_link}
            accentColor={accentColor}
            publishedAt={event.published_at}
            event={event}
          />
        )}

        {/* Listed companies among the actors — usually none */}
        {event.actors?.length > 0 && (
          <EventCompanies actors={event.actors} accentColor={accentColor} />
        )}

        {/* Source Reliability Badge */}
        {(() => {
          const rel = event.reliability ?? 'UNVERIFIED'
          const relColor: Record<string, string> = {
            HIGH:       '#39ff8a',
            MEDIUM:     '#ffd700',
            LOW:        '#ff9c2a',
            UNVERIFIED: '#2a4060',
          }
          const color = relColor[rel] ?? '#2a4060'
          return (
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-widest text-[#2a4060] uppercase">{t('event.labels.source', 'SOURCE')}</span>
              <span
                className="text-[10px] tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  color,
                  border: `1px solid ${color}30`,
                  background: `${color}0a`,
                  letterSpacing: '0.1em',
                  fontWeight: 600,
                }}
              >
                {rel}
              </span>
            </div>
          )
        })()}

        {/* Heat Score */}
        {event.heat_score != null && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] tracking-widest text-[#2a4060] uppercase">{t('event.labels.heat', 'HEAT')}</span>
            <div
              className="flex-1 rounded-sm overflow-hidden"
              style={{ height: '3px', background: 'rgba(0,180,255,0.08)', border: '1px solid rgba(0,180,255,0.1)' }}
            >
              <div
                style={{
                  width: `${Math.min(100, (event.heat_score / 2) * 100)}%`,
                  height: '100%',
                  background: heatColor(event.heat_score),
                  boxShadow: `0 0 4px ${heatColor(event.heat_score)}88`,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <span className="text-[10px] font-mono" style={{ color: heatColor(event.heat_score), minWidth: '24px', textAlign: 'right' }}>
              {event.heat_score.toFixed(2)}
            </span>
            <span
              className="text-[10px] tracking-wider px-1 rounded"
              style={{
                color: heatColor(event.heat_score),
                border: `1px solid ${heatColor(event.heat_score)}30`,
                background: `${heatColor(event.heat_score)}0a`,
              }}
            >
              {expiryLabel(event.expires_at, event.heat_score, sceneNow)}
            </span>
          </div>
        )}

        {/* The related-events radial graph used to sit here. It read the same
            useRelatedEvents(id) fetch as the timeline strip on the left, so the
            panel requested the endpoint twice and drew one result set twice. A
            star topology — every node joined only to the centre — also carries
            no relationship the timeline's ordering does not already show. */}

        {/* Meta row: source · location */}
        <div className="flex items-center justify-between text-[11px] text-[#2a4060] pt-2 border-t border-[rgba(0,180,255,0.07)]">
          <span className="truncate max-w-[130px]">{event.source}</span>
          <span className="text-[#1e3040] mx-1">·</span>
          {countryInfo ? (
            <button
              onClick={e => { e.stopPropagation(); handleOpenCountry() }}
              className="truncate max-w-[110px] transition-colors"
              style={{
                background: 'none', border: 'none', padding: '1px 5px',
                borderRadius: '2px', cursor: 'pointer',
                color: accentColor + 'cc', fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace', outline: 'none',
                borderBottom: `1px solid ${accentColor}44`,
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = accentColor; el.style.borderBottomColor = accentColor }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = accentColor + 'cc'; el.style.borderBottomColor = accentColor + '44' }}
              title={`Open ${countryInfo.countryKey ?? countryInfo.label} region panel`}
            >
              ⊙ {countryInfo.label}
            </button>
          ) : (
            <span className="text-[#1e3040]">{event.location_label && event.location_label !== '—' ? event.location_label : '—'}</span>
          )}
        </div>

        {/* Source link */}
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-[11px] tracking-wide transition-all"
          style={{
            background: `${accentColor}08`, border: `1px solid ${accentColor}22`,
            color: '#3a6080', textDecoration: 'none',
          }}
          onMouseEnter={e => { const el = e.currentTarget; el.style.background = `${accentColor}14`; el.style.borderColor = `${accentColor}55`; el.style.color = accentColor }}
          onMouseLeave={e => { const el = e.currentTarget; el.style.background = `${accentColor}08`; el.style.borderColor = `${accentColor}22`; el.style.color = '#3a6080' }}
        >
          <span style={{ fontSize: '11px', opacity: 0.7 }}>↗</span>
          <span className="truncate flex-1">{hostname()}</span>
          <span style={{ opacity: 0.5, fontSize: '10px', letterSpacing: '0.12em' }}>{t('event.labels.viewSource', 'VIEW SOURCE')}</span>
        </a>

        {/* Coordinates */}
        {event.lat !== null && (
          <div className="text-[11px] text-[#1e3040]">
            {event.lat.toFixed(3)}° / {event.lng?.toFixed(3)}°
          </div>
        )}
      </div>

      {/* ── Focus button ───────────────────────────────────────────────────── */}
      {canFocus && (
        <div className="relative px-3 pb-1">
          <button
            onClick={onFocus}
            className="w-full py-1.5 text-[11px] tracking-widest transition-colors"
            style={{
              background: `${accentColor}08`, border: `1px solid ${accentColor}28`,
              borderRadius: '3px', color: accentColor,
              fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
            }}
          >
            ⊙ {t('panel.focus', 'FOCUS')}
          </button>
        </div>
      )}

      {/* ── Back button ────────────────────────────────────────────────────── */}
      {onBack && (
        <div className="relative px-3 pb-2.5">
          <button
            onClick={onBack}
            className="text-[11px] text-[#2a4060] hover:text-[#00d4ff] transition-colors"
          >
            ← {t('panel.back', 'Back')}
          </button>
        </div>
      )}

      {/* ── Suggested Queries ──────────────────────────────────────────────── */}
      {suggestedQueries.length > 0 && (
        <div className="relative px-3 pb-2 pt-2 border-t border-[rgba(0,180,255,0.07)]">
          <div className="text-[10px] text-[#2a4060] tracking-widest mb-1.5">{t('event.labels.suggestedQueries', 'SUGGESTED QUERIES')}</div>
          <div className="flex flex-wrap gap-1">
            {suggestedQueries.map(q => (
              <button
                key={q}
                onClick={() => { setAgentInput(q); askAgent(q, agentContext) }}
                className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                style={{
                  background: `${accentColor}06`, border: `1px solid ${accentColor}20`,
                  color: accentColor + '99', fontFamily: 'JetBrains Mono, monospace',
                  cursor: 'pointer', letterSpacing: '0.04em',
                }}
                onMouseEnter={e => { const el = e.target as HTMLElement; el.style.background = `${accentColor}12`; el.style.color = accentColor }}
                onMouseLeave={e => { const el = e.target as HTMLElement; el.style.background = `${accentColor}06`; el.style.color = accentColor + '99' }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Agent Chat (hidden in popout mode — AI is in the right column) ──
          The longest section in the panel, and the one most readers use on
          some events and none of the others, so it collapses. The header stays
          whatever the state: a section that vanished entirely would be a
          feature nobody finds again. */}
      {!hideAgent && <div className="relative px-3 pb-3 pt-2 border-t border-[rgba(0,180,255,0.07)]">
        <button
          onClick={toggleAgent}
          aria-expanded={agentOpen}
          title={agentOpen ? t('event.labels.agentCollapse', 'Collapse agent') : t('event.labels.agentExpand', 'Expand agent')}
          className="flex items-center gap-1.5 w-full text-left text-[10px] text-[#2a4060] tracking-widest mb-2"
          style={{
            background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '0.15em',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = accentColor }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#2a4060' }}
        >
          {/* Fixed width so the label does not shift as the glyph changes. */}
          <span style={{ display: 'inline-block', width: '10px' }}>{agentOpen ? '▾' : '▸'}</span>
          <span>{t('event.labels.agent', '◈ INTELLIGENCE AGENT')}</span>
          {/* Collapsed with answers in it: say so, or the reader loses the
              transcript they just generated. */}
          {!agentOpen && agentHistory.length > 0 && (
            <span
              style={{
                marginLeft: 'auto',
                color: accentColor + 'cc',
                border: `1px solid ${accentColor}30`,
                background: `${accentColor}0a`,
                borderRadius: '2px', padding: '0 4px',
              }}
            >{agentHistory.length}</span>
          )}
        </button>

        {agentOpen && <>
        {agentHistory.length > 0 && (
          <div className="mb-2 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,180,255,0.15) transparent' }}>
            {agentHistory.map((entry) => entry.kind === 'subject-added' ? (
              <SubjectAddedNote key={entry.id} labels={entry.labels} accentColor={accentColor} />
            ) : (
              <AgentAnswerBlock key={entry.id} entry={entry} accentColor={accentColor} />
            ))}
            <div ref={agentScrollRef} />
          </div>
        )}

        {agentLoading && awaitingFirstToken(agentHistory) && (
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] text-[#2a4060] tracking-widest">{t('event.labels.analyzing', 'ANALYZING')}</span>
            <span className="agent-loading-dots"><span /><span /><span /></span>
          </div>
        )}

        {agentError && (
          <div className="text-[10px] text-[#ff4d4d] mb-1.5 tracking-wide">⚠ {agentError}</div>
        )}

        <div className="flex gap-1">
          <input
            value={agentInput}
            onChange={e => setAgentInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (agentInput.trim()) { agentAsk(agentInput, agentContext); setAgentInput('') }
              }
            }}
            placeholder={t('event.labels.askAgent', '詢問情報分析...')}
            disabled={agentLoading}
            className="flex-1 text-[11px] px-2 py-1 rounded outline-none"
            style={{
              background: 'rgba(0,180,255,0.05)', border: `1px solid ${accentColor}20`,
              color: '#a8c4d8', fontFamily: 'JetBrains Mono, monospace',
              opacity: agentLoading ? 0.5 : 1,
            }}
          />
          <button
            disabled={agentLoading || !agentInput.trim()}
            onClick={() => { if (agentInput.trim()) { agentAsk(agentInput, agentContext); setAgentInput('') } }}
            className="text-[11px] px-2.5 py-1 rounded transition-colors"
            style={{
              background: agentLoading ? 'rgba(0,212,255,0.03)' : `${accentColor}0a`,
              border: `1px solid ${accentColor}25`,
              color: agentLoading ? '#2a4060' : accentColor,
              fontFamily: 'JetBrains Mono, monospace',
              cursor: agentLoading ? 'wait' : 'pointer',
            }}
          >
            {agentLoading ? '…' : '↵'}
          </button>
        </div>
        </>}
      </div>}
    </div>
  )
}
