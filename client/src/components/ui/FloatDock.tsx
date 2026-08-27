import { useState, useMemo, useRef, useEffect } from 'react'
import { useAppStore, showsChrome } from '../../store'
import { useTranslation } from 'react-i18next'
import {
  CATEGORY_GLYPH, CATEGORY_TINT, severityRank,
  SEVERITY_COLOR, SEVERITY_LABEL, SEVERITY_ORDER,
} from '../../data/symbology'
import type { MapMode, SpaceMapMode } from '../../store'
import { useFilterCriteria } from '../../hooks/useFilteredEvents'
import { countByCategory } from '../../lib/eventFilter'
import { useServiceHealth } from '../../hooks/useServiceHealth'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useSceneTime } from '../../hooks/useSceneTime'
import { SCRUBBER_TOP } from './TimeScrubber'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/**
 * Reads a brief aloud via the server's Azure Speech proxy. A broken TTS call
 * never blocks reading the brief itself, but every failure is logged —
 * this used to fail dead silent (no console output at all), which made a
 * misconfigured or revoked Azure key indistinguishable from "working as
 * intended, brief has no audio".
 */
function speakBrief(summaryHtml: string) {
  const div = document.createElement('div')
  div.innerHTML = summaryHtml
  const text = (div.textContent ?? '').trim()
  if (!text) return
  fetch(`${API}/api/speech/synthesize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      return res.blob()
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.addEventListener('ended', () => URL.revokeObjectURL(url))
      audio.play().catch((err) => {
        URL.revokeObjectURL(url)
        console.warn('[IntelBrief] Playback blocked:', err)
      })
    })
    .catch((err) => {
      console.warn('[IntelBrief] Speech synthesis failed:', err)
    })
}

/** Gap between the bottom of the screen and the dock. */
const DOCK_BOTTOM = 12
/** Breathing room between a dock popover and whatever it opens over. */
const POPOVER_GAP = 8
/** Rendered height of the map-mode legend pill (measured: one text row plus
 *  its 4px/1px padding and border — 24.6px in practice, rounded up here). */
const LEGEND_HEIGHT = 25

/**
 * Bottom offset, in the dock's own coordinates, for a popover that opens
 * upwards and must clear the time scrubber.
 *
 * The scrubber is a sibling fixed to the bottom of the screen, so a popover
 * anchored to the dock has to be pushed past it explicitly — the legend was
 * previously at a hand-picked 44px and landed straight across the histogram.
 * Derived from the scrubber's own exported geometry so it tracks any change
 * there. The parameter asks about the scrubber rather than about a HUD mode,
 * because that is the thing actually in the way — when it is not rendered the
 * popover drops back down instead of floating over a gap.
 */
function popoverBottom(scrubberHidden: boolean, restingOffset: number): number {
  if (scrubberHidden) return restingOffset
  return Math.max(restingOffset, SCRUBBER_TOP - DOCK_BOTTOM + POPOVER_GAP)
}

/**
 * Icons for the four surface fills. All four are abstract pattern marks rather
 * than symbols borrowed from elsewhere: ◈ is the app's panel/section marker
 * (every panel title and agent header carries it, and so does the EVENT PANEL
 * button further along this same strip), so POSTURE using it put two identical
 * glyphs in one dock and gave a map fill a meaning it does not have.
 *
 * ▨ is a hatched square against POLITICAL's solid ▦ — both are surface fills,
 * one categorical and one graduated, which is exactly the difference.
 */
const MAP_MODES: { id: MapMode; icon: string; label: string }[] = [
  { id: 'none',      icon: '○', label: 'NONE'      },
  { id: 'political', icon: '▦', label: 'POLITICAL' },
  { id: 'posture',   icon: '▨', label: 'POSTURE'   },
  { id: 'activity',  icon: '≋', label: 'ACTIVITY'  },
]

/**
 * Shown instead of the four above once the camera is clear of Earth.
 *
 * The Earth modes all paint the globe's surface through the GeoJSON layer,
 * which is not drawn at that range — so offering them there was offering
 * controls that could not act. Only two here because at system range there is
 * one question worth answering: which bodies have anything happening.
 */
const SPACE_MAP_MODES: { id: SpaceMapMode; icon: string; label: string }[] = [
  { id: 'none',    icon: '○', label: 'NONE'    },
  { id: 'posture', icon: '▨', label: 'POSTURE' },
]

interface DockBtnProps {
  icon?: string
  iconSrc?: string
  label: string
  badge?: number | string
  error?: boolean
  loading?: boolean
  color?: string
  active?: boolean
  dim?: boolean
  onClick: () => void
}

function DockBtn({ icon, iconSrc, label, badge, error, loading, color = '#4a6070', active, dim, onClick }: DockBtnProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Tooltip — appears above the button */}
      {hovered && (
        <div style={{
          position: 'absolute', bottom: '36px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(4,9,22,0.95)', border: '1px solid rgba(0,180,255,0.2)',
          borderRadius: '3px', padding: '3px 7px', whiteSpace: 'nowrap',
          color: '#a8c4d8', fontSize: '10px', letterSpacing: '0.1em',
          pointerEvents: 'none', zIndex: 100,
        }}>
          {label}
        </div>
      )}
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: '28px', height: '28px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active ? `${color}18` : 'transparent',
          border: active ? `1px solid ${color}50` : '1px solid transparent',
          borderRadius: '3px', cursor: 'pointer',
          color: hovered || active ? color : '#3a5060',
          opacity: dim ? 0.45 : 1,
          fontSize: '12px', transition: loading ? 'none' : 'all 0.15s',
          position: 'relative',
          animation: loading ? 'loadingRing 0.9s ease-in-out infinite' : undefined,
        }}
      >
        {iconSrc ? <img src={iconSrc} alt="" style={{ width: 16, height: 16, display: 'block' }} /> : icon}
        {badge != null && (typeof badge === 'string' ? badge.length > 0 : Number(badge) > 0) && (
          <span style={{
            position: 'absolute', top: '2px', right: '2px',
            background: '#ff4d4d', color: '#fff',
            fontSize: '10px', fontWeight: 700,
            borderRadius: '2px', padding: '0 3px',
            lineHeight: '12px', minWidth: '12px', textAlign: 'center',
          }}>
            {typeof badge === 'number' && badge > 99 ? '99+' : badge}
          </span>
        )}
        {error && (
          <span style={{
            position: 'absolute', top: '2px', left: '2px',
            background: '#ff8c00', color: '#fff',
            fontSize: '10px', fontWeight: 700,
            borderRadius: '2px', padding: '0 3px',
            lineHeight: '12px', minWidth: '12px', textAlign: 'center',
          }}>!</span>
        )}
      </button>
    </div>
  )
}

export function FloatDock() {
  const { t } = useTranslation()
  const events            = useAppStore((s) => s.events)
  const intelBrief         = useAppStore((s) => s.intelBrief)
  const intelBriefHistory  = useAppStore((s) => s.intelBriefHistory)
  const briefRead          = useAppStore((s) => s.briefRead)
  const setBriefRead       = useAppStore((s) => s.setBriefRead)
  const [showBrief, setShowBrief] = useState(false)
  const briefRef = useRef<HTMLDivElement>(null)
  const briefModalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(briefModalRef, showBrief)
  const hudMode           = useAppStore((s) => s.hudMode)
  const setHudMode        = useAppStore((s) => s.setHudMode)
  const toggleImmersive   = useAppStore((s) => s.toggleImmersive)
  const activePanelId     = useAppStore((s) => s.activePanelId)
  const setActivePanelId  = useAppStore((s) => s.setActivePanelId)
  const selectedCountry   = useAppStore((s) => s.selectedCountry)
  const showAnnotationCanvas = useAppStore((s) => s.showAnnotationCanvas)
  const setShowAnnotationCanvas = useAppStore((s) => s.setShowAnnotationCanvas)
  const showConfig        = useAppStore((s) => s.showConfig)
  const setShowConfig     = useAppStore((s) => s.setShowConfig)
  const hiddenCategories  = useAppStore((s) => s.hiddenCategories)

  const showEarthTexture    = useAppStore((s) => s.showEarthTexture)
  const setShowEarthTexture = useAppStore((s) => s.setShowEarthTexture)

  const showAircraftLayer    = useAppStore((s) => s.showAircraftLayer)
  const setShowAircraftLayer = useAppStore((s) => s.setShowAircraftLayer)
  const showSatellitesLayer    = useAppStore((s) => s.showSatellitesLayer)
  const setShowSatellitesLayer = useAppStore((s) => s.setShowSatellitesLayer)
  const showShipsLayer       = useAppStore((s) => s.showShipsLayer)
  const setShowShipsLayer    = useAppStore((s) => s.setShowShipsLayer)
  const showConflictLayer    = useAppStore((s) => s.showConflictLayer)
  const setShowConflictLayer = useAppStore((s) => s.setShowConflictLayer)
  const mapMode              = useAppStore((s) => s.mapMode)
  const setMapMode           = useAppStore((s) => s.setMapMode)
  const spaceMapMode         = useAppStore((s) => s.spaceMapMode)
  const setSpaceMapMode      = useAppStore((s) => s.setSpaceMapMode)
  const nearEarth            = useAppStore((s) => s.nearEarth)
  const layerErrors          = useAppStore((s) => s.layerErrors)
  const layerLoading         = useAppStore((s) => s.layerLoading)
  const contextEntities      = useAppStore((s) => s.contextEntities)
  const showContextPanel     = useAppStore((s) => s.showContextPanel)
  const setShowContextPanel  = useAppStore((s) => s.setShowContextPanel)
  const showPredictionPanel    = useAppStore((s) => s.showPredictionPanel)
  const setShowPredictionPanel = useAppStore((s) => s.setShowPredictionPanel)


  const serviceHealth      = useServiceHealth()
  const socketConnected    = useAppStore((s) => s.socketConnected)
  const { now: sceneNow, isLive } = useSceneTime()

  // 12-bar hourly sparkline for event arrival rate
  const sparklineBars = useMemo(() => {
    const now   = sceneNow
    const bars  = new Array(12).fill(0)
    for (const e of events) {
      const ts = e.published_at ? new Date(e.published_at).getTime() : 0
      if (ts <= 0) continue
      const hoursAgo = (now - ts) / 3_600_000
      if (hoursAgo >= 0 && hoursAgo < 12) {
        bars[11 - Math.floor(hoursAgo)]++
      }
    }
    const peak = Math.max(1, ...bars)
    return bars.map((v) => v / peak)  // 0..1 normalised heights
  }, [events])

  // The busiest categories right now, counted through the same rule as the feed
  // rather than off the raw store — otherwise these shortcuts rank by a set the
  // operator is not looking at. Hidden categories are dropped here, unlike on
  // the filter chips: this is a jump list, and there is nothing to jump to in a
  // category that is switched off.
  const criteria = useFilterCriteria()
  const topCats = useMemo(() => {
    const hidden = new Set(hiddenCategories)
    return Object.entries(countByCategory(events, criteria))
      .filter(([cat]) => !hidden.has(cat))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
  }, [events, criteria, hiddenCategories])

  // Close brief when clicking outside
  useEffect(() => {
    if (!showBrief) return
    const handler = (e: MouseEvent) => {
      if (briefRef.current && !briefRef.current.contains(e.target as Node)) {
        setShowBrief(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showBrief])

  // Both the brief and the map-mode legend anchor to the dock via
  // popoverBottom(), and while the scrubber is visible they clamp to the
  // exact same offset regardless of their own resting values — so when both
  // are on screen at once, the legend sits inside the brief's footprint
  // instead of below it. The brief needs to clear whatever the legend's own
  // bottom position turns out to be, not just its own resting offset.
  const legendVisible = (nearEarth && (mapMode === 'posture' || mapMode === 'activity'))
    || (!nearEarth && spaceMapMode === 'posture')
  const briefBottom = Math.max(
    popoverBottom(!showsChrome(hudMode), 52),
    legendVisible ? popoverBottom(!showsChrome(hudMode), 44) + LEGEND_HEIGHT + POPOVER_GAP : 0,
  )

  return (
    <div ref={briefRef} style={{ position: 'fixed', bottom: `${DOCK_BOTTOM}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>

      {/* Intel Brief modal */}
      {showBrief && intelBrief && (
        <div
          ref={briefModalRef}
          role="dialog"
          aria-modal="true"
          aria-label="Intel Brief"
          style={{
          position: 'absolute', bottom: `${briefBottom}px`,
          left: '50%', transform: 'translateX(-50%)',
          width: '340px',
          background: 'rgba(4,9,22,0.97)',
          border: '1px solid rgba(255,215,0,0.3)',
          borderTop: '2px solid #ffd700',
          borderRadius: '4px',
          padding: '10px 12px',
          boxShadow: '0 0 24px rgba(255,215,0,0.12)',
          backdropFilter: 'blur(8px)',
          fontFamily: 'JetBrains Mono, monospace',
          animation: 'toastEnter 0.25s cubic-bezier(0.34,1.56,0.64,1) both',
          maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexShrink: 0 }}>
            <span style={{ color: '#ffd700', fontSize: '10px', letterSpacing: '0.15em', fontWeight: 700 }}>◇ INTEL BRIEF</span>
            <span style={{ color: '#2a4060', fontSize: '10px' }}>
              {new Date(intelBrief.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div
            className="agent-response"
            style={{ color: '#a8c4d8', fontSize: '11px', lineHeight: 1.5, flexShrink: 0 }}
            dangerouslySetInnerHTML={{ __html: intelBrief.summary }}
          />
          {/* Brief history — older entries collapsible */}
          {intelBriefHistory.length > 1 && (
            <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,215,0,0.12)', paddingTop: '6px', overflowY: 'auto', flexShrink: 1 }}>
              <div style={{ color: '#4a5060', fontSize: '10px', letterSpacing: '0.12em', marginBottom: '5px' }}>PREVIOUS BRIEFS</div>
              {intelBriefHistory.slice(1).map((b) => (
                <details key={b.id} style={{ marginBottom: '5px' }}>
                  <summary style={{
                    color: '#3a5060', fontSize: '10px', letterSpacing: '0.1em',
                    cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '5px',
                  }}>
                    <span style={{ color: '#2a3850' }}>▸</span>
                    {new Date(b.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    {new Date(b.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </summary>
                  <div
                    className="agent-response"
                    style={{ color: '#6a8090', fontSize: '10px', lineHeight: 1.5, marginTop: '4px', paddingLeft: '10px' }}
                    dangerouslySetInnerHTML={{ __html: b.summary }}
                  />
                </details>
              ))}
            </div>
          )}
        </div>
      )}

    {/* Map-mode legend — a fill scheme with no key is decoration. Political
        mode needs none: its colours deliberately mean nothing.
        Follows the family in force, or it would key a mode that is neither
        selected nor drawn. The severity band is shared between them, so the
        same key reads for country fills and for body halos. */}
    {legendVisible && (
      <div style={{
        position: 'absolute', bottom: `${popoverBottom(!showsChrome(hudMode), 44)}px`,
        left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '4px 9px', whiteSpace: 'nowrap',
        background: 'rgba(4,9,22,0.92)',
        border: '1px solid rgba(0,180,255,0.15)',
        borderRadius: '4px', backdropFilter: 'blur(8px)',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        <span style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#2a4a63' }}>
          {nearEarth
            ? `${t(`mapMode.${mapMode}`, mapMode.toUpperCase())} · 24H`
            : `${t('mapMode.space', 'SPACE')} · ${t('mapMode.posture', 'POSTURE')}`}
        </span>
        {(nearEarth ? mapMode === 'posture' : true) ? (
          SEVERITY_ORDER.map((k) => (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{
                width: '9px', height: '9px', borderRadius: '2px',
                background: SEVERITY_COLOR[k], opacity: 0.85,
              }} />
              <span style={{ fontSize: '10px', color: SEVERITY_COLOR[k] }}>{SEVERITY_LABEL[k]}</span>
            </span>
          ))
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '10px', color: '#2a4a63' }}>{t('mapMode.less', 'LESS')}</span>
            <span style={{
              width: '76px', height: '9px', borderRadius: '2px',
              background: 'linear-gradient(90deg, rgba(63,200,224,0.10), rgba(63,200,224,0.55))',
            }} />
            <span style={{ fontSize: '10px', color: '#3fc8e0' }}>{t('mapMode.more', 'MORE')}</span>
          </span>
        )}
      </div>
    )}

    <div style={{
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '4px',
      background: 'rgba(4,9,22,0.88)',
      border: '1px solid rgba(0,180,255,0.15)',
      borderRadius: '6px',
      padding: '4px 6px',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 0 20px rgba(0,60,120,0.3)',
      animation: 'navFadeIn 0.2s ease both',
      whiteSpace: 'nowrap',
    }}>
      {/* Top accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 8, right: 8, height: '2px',
        background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.5), transparent)',
        borderRadius: '1px', pointerEvents: 'none',
      }} />

      {/* ARGUS logo / status */}
      <div style={{
        width: '20px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRight: '1px solid rgba(0,180,255,0.1)', marginRight: '2px', paddingRight: '6px',
      }}>
        <div
          title={socketConnected ? 'Connected' : 'Reconnecting…'}
          style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: socketConnected ? '#39ff8a' : '#ff8c00',
            boxShadow: socketConnected ? '0 0 6px #39ff8a' : '0 0 6px #ff8c00',
            animation: socketConnected ? 'pulse 2s infinite' : 'pulse 0.8s infinite',
            transition: 'background 0.5s, box-shadow 0.5s',
          }}
        />
      </div>

      {/* The HIGH/CRITICAL alert count used to live here. The status bar's
          POSTURE module now owns it with more precision (per-severity, each
          cell jumping to its own newest event), and two alert counts computed
          from different sets is the ambiguity this pass exists to remove. */}

      {/* Service health badge — only shows when degraded */}
      {!serviceHealth.healthy && (
        <DockBtn
          // Not ⚙ — that is CONFIGURATION further along this strip, and this
          // badge only appears when something is broken, so the two gears
          // showed up together exactly when the alarm needed to be legible.
          // ⏻ reads as a service being down rather than a setting to open.
          icon="⏻"
          label={serviceHealth.ollamaOnline ? 'SCRAPER STALLED' : 'OLLAMA OFFLINE'}
          badge="!"
          color="#ff8c00"
          onClick={() => {/* informational only */}}
        />
      )}

      {/* Event feed with sparkline */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <DockBtn
          icon="◉"
          label={`INTEL FEED — ${events.length} ITEMS`}
          badge={events.length}
          color="#00d4ff"
          active={hudMode === 'full'}
          onClick={() => setHudMode('full')}
        />
        {/* 12-bar sparkline rendered beneath the button */}
        <svg width="28" height="6" style={{ position: 'absolute', bottom: '-5px', left: 0, opacity: 0.7, pointerEvents: 'none' }}>
          {sparklineBars.map((h, i) => (
            <rect
              key={i}
              x={i * (28 / 12) + 0.5}
              y={6 - h * 5}
              width={28 / 12 - 1}
              height={h * 5}
              fill={`rgba(0,212,255,${0.3 + h * 0.7})`}
              rx="0.5"
            />
          ))}
        </svg>
      </div>

      {/* Active event panel */}
      {activePanelId && (
        <DockBtn
          icon="◈"
          label="EVENT PANEL"
          color="#ff9c2a"
          active
          onClick={() => setActivePanelId(activePanelId)}
        />
      )}

      {/* Region panel */}
      {selectedCountry && (
        <DockBtn
          icon="⊙"
          label={`REGION: ${selectedCountry.name.toUpperCase()}`}
          color="#00ffcc"
          active
          onClick={() => {/* already visible */}}
        />
      )}

      {/* Divider */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(0,180,255,0.12)', margin: '0 2px' }} />

      {/* Top category quick-launch */}
      {topCats.map(([cat, count]) => (
        <DockBtn
          key={cat}
          icon={CATEGORY_GLYPH[cat as keyof typeof CATEGORY_GLYPH] ?? '◇'}
          label={`${cat.replace(/_/g,' ')} (${count})`}
          color={CATEGORY_TINT[cat as keyof typeof CATEGORY_TINT] ?? '#4a6070'}
          onClick={() => {
            // Most severe first, newest as tiebreak — never array order.
            const ev = events
              .filter(e => e.category === cat)
              .sort((a, b) =>
                severityRank(b.intensity) - severityRank(a.intensity) ||
                new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
              )[0]
            if (ev) setActivePanelId(ev.id)
          }}
        />
      ))}

      {/* Divider */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(0,180,255,0.12)', margin: '0 2px' }} />

      {/* ── Globe surface texture ── */}
      <DockBtn
        icon="◑"
        label="EARTH TEXTURE"
        color="#4a9eff"
        active={showEarthTexture}
        onClick={() => setShowEarthTexture(!showEarthTexture)}
      />

      {/* ── Map mode — exclusive. Only one variable may be painted across the
             globe at a time; the overlays after the next divider are additive
             because point and line data does not compete for the surface. ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1px',
        marginLeft: '4px', padding: '1px',
        border: '1px solid rgba(0,180,255,0.15)', borderRadius: '4px',
        background: 'rgba(0,20,40,0.35)',
      }}>
        {(nearEarth ? MAP_MODES : SPACE_MAP_MODES).map(({ id, icon, label }) => {
          const active = nearEarth ? mapMode === id : spaceMapMode === id
          return (
            <button
              key={id}
              onClick={() => (nearEarth
                ? setMapMode(id as MapMode)
                : setSpaceMapMode(id as SpaceMapMode))}
              title={`${t('mapMode.label', 'MAP MODE')} — ${t(`mapMode.${id}`, label)}`}
              aria-pressed={active}
              style={{
                width: '24px', height: '24px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', borderRadius: '3px', border: 'none',
                background: active ? 'rgba(0,212,255,0.18)' : 'transparent',
                color: active ? '#00d4ff' : '#3a5060',
                cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
              }}
            >{icon}</button>
          )
        })}
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(0,180,255,0.12)', margin: '0 2px' }} />

      <DockBtn
        iconSrc="/icons/aircraft.png"
        label={isLive ? 'AIRCRAFT (ADS-B)' : 'AIRCRAFT (ADS-B) — LIVE ONLY, HIDDEN WHILE REVIEWING'}
        color="#a0c4ff"
        active={showAircraftLayer}
        dim={!isLive}
        error={showAircraftLayer && layerErrors.aircraft}
        loading={showAircraftLayer && layerLoading.aircraft}
        onClick={() => setShowAircraftLayer(!showAircraftLayer)}
      />
      <DockBtn
        iconSrc="/icons/satellite.png"
        label={isLive ? 'SATELLITES (TLE)' : 'SATELLITES (TLE) — LIVE ONLY, HIDDEN WHILE REVIEWING'}
        color="#00d4ff"
        active={showSatellitesLayer}
        dim={!isLive}
        error={showSatellitesLayer && layerErrors.satellites}
        loading={showSatellitesLayer && layerLoading.satellites}
        onClick={() => setShowSatellitesLayer(!showSatellitesLayer)}
      />
      <DockBtn
        iconSrc="/icons/ship.png"
        label={isLive ? 'VESSELS (AIS)' : 'VESSELS (AIS) — LIVE ONLY, HIDDEN WHILE REVIEWING'}
        color="#39ff8a"
        active={showShipsLayer}
        dim={!isLive}
        error={showShipsLayer && layerErrors.ships}
        loading={showShipsLayer && layerLoading.ships}
        onClick={() => setShowShipsLayer(!showShipsLayer)}
      />
      <DockBtn
        // Not ⚔ — that is the ARMED_CONFLICT category glyph, and the category
        // quick-filters a few buttons to the left are generated from the same
        // table. Two ⚔ in one strip meant "filter the feed to conflict" and
        // "draw front lines on the globe" looked identical. ▰ reads as a band
        // of held ground, which is what the layer actually draws.
        iconSrc="/icons/conflict.png"
        label={t('conflictLayer.toggle', 'CONFLICT FRONTS')}
        color="#ff6600"
        active={showConflictLayer}
        error={showConflictLayer && layerErrors.conflict}
        loading={showConflictLayer && layerLoading.conflict}
        onClick={() => setShowConflictLayer(!showConflictLayer)}
      />
      {/* The old EVENT HEATMAP toggle became the ACTIVITY map mode. It was a
          surface fill competing with the other fills, so it belongs in the
          exclusive mode group, not among the additive overlays. */}

      {/* Annotation system toggle */}
      <DockBtn
        iconSrc="/icons/pin.png"
        label={t('annotation.toggle', 'ANNOTATION')}
        color="#9b6dff"
        active={showAnnotationCanvas}
        onClick={() => setShowAnnotationCanvas(!showAnnotationCanvas)}
      />

      {/* Multi-entity context — the only durable way back to the panel.
          Every other route in is a per-panel ⊕ that disables itself once the
          entity is collected, so closing the panel used to strand whatever had
          been gathered. The badge also makes the collection visible: without
          it there is nothing on screen saying you are holding anything. */}
      {/* Shown while empty too, now that the panel takes `@` mentions: opening
          it is how you start a collection from a name rather than from a panel
          that happens to be on screen. */}
      <DockBtn
        // ⧉ reads as several things held together, which is what the
        // collection is. Deliberately not ◈: that marks a panel/section
        // throughout the app, and this button is a collection, not a panel.
        icon="⧉"
        label={`${t('context.title', 'MULTI-ENTITY CONTEXT')} (${contextEntities.length})`}
        badge={contextEntities.length || undefined}
        color="#00ffcc"
        active={showContextPanel}
        onClick={() => setShowContextPanel(!showContextPanel)}
      />


      {/* Prediction markets — the only way in, since these rows hang off no
          event and no country. % reads as the thing the panel is: a price
          quoted as a percentage. Deliberately not ◈, which marks a panel
          section throughout the app rather than a way to open one. */}
      <DockBtn
        icon="%"
        label={t('prediction.toggle', 'PREDICTION MARKETS')}
        color="#ffb347"
        active={showPredictionPanel}
        onClick={() => setShowPredictionPanel(!showPredictionPanel)}
      />

      {/* Intel brief */}
      {intelBrief && (
        <DockBtn
          icon="◇"
          label="INTEL BRIEF"
          badge={briefRead ? undefined : '!'}
          color="#ffd700"
          active={showBrief}
          onClick={() => {
            setShowBrief((v) => {
              const next = !v
              if (next) speakBrief(intelBrief.summary)
              return next
            })
            setBriefRead(true)
          }}
        />
      )}

      {/* Config */}
      <DockBtn
        icon="⚙"
        label="CONFIGURATION"
        color="#4a6fa5"
        active={showConfig}
        onClick={() => setShowConfig(!showConfig)}
      />

      {/* Keyboard shortcuts */}
      <DockBtn
        icon="?"
        label="KEYBOARD SHORTCUTS"
        color="#4a6070"
        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
      />

      {/* Divider */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(0,180,255,0.12)', margin: '0 2px' }} />

      {/* Immersive toggle. Leaving returns to whichever mode you came from,
          so dropping into immersive from the icon stack and back does not
          silently put the sidebar in front of you. */}
      {hudMode === 'immersive' ? (
        <DockBtn
          icon="⊟"
          label="EXIT IMMERSIVE (I)"
          color="#ff9c2a"
          onClick={toggleImmersive}
        />
      ) : (
        <DockBtn
          icon="⊞"
          label="IMMERSIVE MODE (I)"
          color="#4a6070"
          onClick={toggleImmersive}
        />
      )}
    </div>
    </div>
  )
}
