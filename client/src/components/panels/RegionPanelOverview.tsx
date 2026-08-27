/**
 * RegionPanelOverview — the body of RegionPanel, split into a pinned identity
 * block and three tabbed content pages.
 *
 * Tabs rather than one long column: nine stacked sections made the panel far
 * taller than it was wide. Tabs hold the height at roughly the tallest single
 * page, and give the event list room to be a real, complete list — which is
 * what makes the panel useful when globe markers overlap and the map itself
 * can no longer separate them.
 *
 *   OVERVIEW  tags · stats grid · stability bar
 *   EVENTS    full region event list · key figures
 *   PROFILE   economic structure · Wikipedia summary
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { eventSymbol } from '../../data/symbology'
import type { CountryInfo } from '../../data/countryData'
import { useAppStore } from '../../store'
import type { SelectedCountry } from '../../store'
import type { ArgusEvent } from '../../types'
import { linkableEntityNames } from '../../utils/entityLinker'
import { EntityGlyph } from './EntityGlyph'
import { RegionIndices } from './RegionIndices'
import { RegionMarkets } from './RegionMarkets'
import { eventTitle } from '../../lib/eventText'

export type RegionTab = 'overview' | 'events' | 'profile'

// ── helpers ──────────────────────────────────────────────────────────────────

const TAG_COLOR: Record<string, string> = {
  'ACTIVE CONFLICT':       '#ff4d4d',
  'CRITICAL ALERT':        '#ff6b35',
  'ECONOMIC STRESS':       '#ffd700',
  'DEMOCRACY':             '#39ff8a',
  'AUTHORITARIAN':         '#ff9c2a',
  'MILITARY JUNTA':        '#ff4d4d',
  'TOTALITARIAN':          '#ff4d4d',
  'COMMUNIST':             '#ff4d4d',
  'SINGLE-PARTY STATE':    '#ff6b35',
  'HYBRID REGIME':         '#ff9c2a',
  'THEOCRACY':             '#ff9c2a',
  'FRAGILE STATE':         '#ff9c2a',
  'HIGH TENSION':          '#ff9c2a',
  'OCCUPIED TERRITORY':    '#ff4d4d',
  'POST-CONFLICT':         '#ffd700',
  'TRANSITIONAL':          '#ffd700',
  'PARTIAL RECOGNITION':   '#c8cdd2',
  'DIVIDED GOVERNMENT':    '#ff9c2a',
  'REPUBLIC':              '#4a6fa5',
  'FEDERAL':               '#4a6fa5',
  'FEDERAL REPUBLIC':      '#4a6fa5',
  'CONSTITUTIONAL MONARCHY':'#4a6fa5',
  'ABSOLUTE MONARCHY':     '#c8a030',
}
function tagColor(tag: string): string { return TAG_COLOR[tag] ?? '#4a6070' }

function formatGdp(gdpB: number): string {
  if (gdpB >= 1000) return `$${(gdpB / 1000).toFixed(1)}T`
  return `$${Math.round(gdpB)}B`
}
function formatPop(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)}B`
  return `${m.toFixed(1)}M`
}

/** Age against scene time, not the wall clock — the panel follows the scrubber. */
function ageFrom(sceneNow: number, iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const m = Math.max(0, Math.floor((sceneNow - t) / 60_000))
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const BAR_COLORS = ['#00d4ff', '#4a6fa5', '#9b6dff', '#ff9c2a', '#39ff8a']

function IndustryBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div style={{ marginBottom: '5px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
        <span style={{ color: '#6a8090', fontSize: '10px', letterSpacing: '0.08em' }}>{label.toUpperCase()}</span>
        <span style={{ color: '#4a6fa5', fontSize: '10px' }}>{pct}%</span>
      </div>
      <div style={{ height: '3px', background: 'rgba(0,180,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.15em', marginBottom: '6px' }}>
      {children}
    </div>
  )
}

// ── Key actors section ────────────────────────────────────────────────────────
//
// "Key figures" was a claim about the contents that the filter behind it never
// made: these are the region's recurring actors, and a recurring actor is as
// often a ministry or a company as a person.

function RegionKeyActors({ regionEvents, addSelectedEntity }: {
  regionEvents: ArgusEvent[]
  addSelectedEntity: (p: import('../../store').SelectedEntity) => void
}) {
  const entities = useMemo(() => {
    const counts = new Map<string, number>()
    for (const ev of regionEvents) {
      for (const name of linkableEntityNames(ev.actors ?? [])) {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  }, [regionEvents])

  if (entities.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid rgba(0,180,255,0.07)', padding: '8px 12px 6px' }}>
      <SectionLabel>KEY ACTORS</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {entities.map(([name, count]) => (
          <button
            key={name}
            onClick={() => addSelectedEntity({ name, wikiTitle: name })}
            title={`View entity: ${name}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              background: '#c084fc08', border: '1px solid #c084fc22',
              borderRadius: '2px', color: '#c084fccc', fontSize: '10px',
              padding: '2px 6px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.04em',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#c084fc18'; e.currentTarget.style.color = '#c084fc' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#c084fc08'; e.currentTarget.style.color = '#c084fccc' }}
          >
            <EntityGlyph name={name} /> {name}
            {count > 1 && <span style={{ opacity: 0.6, fontSize: '10px' }}>×{count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Identity block + tab bar (pinned above the scroll area) ───────────────────

interface IdentityProps {
  country: SelectedCountry
  info: CountryInfo | null
  tab: RegionTab
  setTab: (t: RegionTab) => void
  eventCount: number
  focusOnEarthSurface: ((lat: number, lng: number) => void) | null | undefined
}

export function RegionPanelIdentity({
  country, info, tab, setTab, eventCount, focusOnEarthSurface,
}: IdentityProps) {
  const { t } = useTranslation()

  const TABS: { id: RegionTab; label: string; badge?: number }[] = [
    { id: 'overview', label: t('region.tab.overview', 'OVERVIEW') },
    { id: 'events',   label: t('region.tab.events',   'EVENTS'), badge: eventCount },
    { id: 'profile',  label: t('region.tab.profile',  'PROFILE') },
  ]

  return (
    <div style={{ flexShrink: 0, padding: '10px 12px 0' }}>
      {/* Flag · name · capital · coords · focus */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '9px' }}>
        {info && (
          <img
            src={`https://flagcdn.com/40x30/${info.code.toLowerCase()}.png`}
            srcSet={`https://flagcdn.com/80x60/${info.code.toLowerCase()}.png 2x`}
            width="40" height="30"
            alt={country.name}
            style={{ flexShrink: 0, borderRadius: '2px', objectFit: 'cover', border: '1px solid rgba(0,180,255,0.12)' }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#c8dde8', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em' }}>
            {country.name.toUpperCase()}
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
            {info && (
              <span style={{ color: '#4a6070', fontSize: '10px', letterSpacing: '0.1em' }}>
                ⊙ {info.capital}
              </span>
            )}
            <span style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.1em' }}>
              {country.lat.toFixed(2)}° {country.lat >= 0 ? 'N' : 'S'}&nbsp;&nbsp;
              {Math.abs(country.lng).toFixed(2)}° {country.lng >= 0 ? 'E' : 'W'}
            </span>
          </div>
        </div>
        {focusOnEarthSurface && (
          <button
            onClick={() => focusOnEarthSurface(country.lat, country.lng)}
            title={t('panel.focus_region', 'FOCUS REGION')}
            style={{
              flexShrink: 0, padding: '3px 8px', background: 'rgba(0,212,255,0.04)',
              border: '1px solid rgba(0,212,255,0.15)', borderRadius: '3px',
              color: '#2a5070', fontSize: '10px', letterSpacing: '0.12em',
              cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#00d4ff'; e.currentTarget.style.borderColor = 'rgba(0,212,255,0.3)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#2a5070'; e.currentTarget.style.borderColor = 'rgba(0,212,255,0.15)' }}
          >⊙</button>
        )}
      </div>

      {/* Tab bar — same segmented-control language as the dock's map-mode group */}
      <div style={{
        display: 'flex', gap: '1px', padding: '1px',
        border: '1px solid rgba(0,180,255,0.15)', borderRadius: '4px',
        background: 'rgba(0,20,40,0.35)',
      }}>
        {TABS.map(({ id, label, badge }) => {
          const active = tab === id
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={active}
              style={{
                flex: 1, padding: '4px 2px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                fontSize: '10px', letterSpacing: '0.1em', borderRadius: '3px', border: 'none',
                fontFamily: 'JetBrains Mono, monospace',
                background: active ? 'rgba(0,212,255,0.18)' : 'transparent',
                color: active ? '#00d4ff' : '#3a5060',
                cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
              }}
            >
              {label}
              {badge != null && badge > 0 && (
                <span style={{
                  fontSize: '10px', padding: '0 3px', borderRadius: '2px',
                  background: active ? 'rgba(0,212,255,0.2)' : 'rgba(0,180,255,0.1)',
                  color: active ? '#00d4ff' : '#3a5060',
                }}>{badge}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab content ───────────────────────────────────────────────────────────────

interface ContentProps {
  tab: RegionTab
  country: SelectedCountry
  info: CountryInfo | null
  allTags: string[]
  regionEvents: ArgusEvent[]
  sceneNow: number
  onOpenEvent: (id: string) => void
  wikiData: {
    extract: string
    thumbnail?: { source: string }
    content_urls?: { desktop?: { page?: string } }
  } | null
  wikiLoading: boolean
}

export function RegionPanelTabContent({
  tab, country, info, allTags, regionEvents, sceneNow, onOpenEvent,
  wikiData, wikiLoading,
}: ContentProps) {
  const { t, i18n } = useTranslation()
  const addSelectedEntity = useAppStore(s => s.addSelectedEntity)

  const stabilityColor = !info ? '#4a6070'
    : info.stability >= 70 ? '#39ff8a'
    : info.stability >= 45 ? '#ff9c2a' : '#ff4d4d'

  const gdpPerCapita = info && info.populationM > 0
    ? `$${Math.round((info.gdpB * 1e9) / (info.populationM * 1e6) / 1000)}k`
    : '—'

  // ── OVERVIEW ───────────────────────────────────────────────────────────────
  if (tab === 'overview') {
    return (
      <div style={{ padding: '10px 12px 12px' }}>
        {allTags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
            {allTags.map(tag => (
              <span key={tag} style={{
                fontSize: '10px', letterSpacing: '0.1em', padding: '2px 5px',
                border: `1px solid ${tagColor(tag)}40`,
                background: `${tagColor(tag)}12`,
                color: tagColor(tag), borderRadius: '2px',
              }}>{tag}</span>
            ))}
          </div>
        )}

        {/* Stats — one row of four now that the panel is wide enough for it */}
        {info && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '1px', background: 'rgba(0,180,255,0.06)',
            border: '1px solid rgba(0,180,255,0.08)', borderRadius: '3px',
            marginBottom: '12px', overflow: 'hidden',
          }}>
            {[
              { label: 'POPULATION', val: formatPop(info.populationM) },
              { label: 'GDP',        val: formatGdp(info.gdpB) },
              { label: 'GDP/CAPITA', val: gdpPerCapita },
              { label: 'STABILITY',  val: `${info.stability}/100` },
            ].map(({ label, val }) => (
              <div key={label} style={{ padding: '6px 8px', background: 'rgba(4,9,22,0.6)' }}>
                <div style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.08em', marginBottom: '3px' }}>{label}</div>
                <div style={{ color: '#a8c4d8', fontSize: '11px', fontWeight: 600 }}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {info && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.1em' }}>STABILITY INDEX</span>
              <span style={{ color: '#4a6fa5', fontSize: '10px' }}>{info.stability}/100</span>
            </div>
            <div style={{ height: '4px', background: 'rgba(0,180,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                width: `${info.stability}%`, height: '100%', borderRadius: '2px',
                background: stabilityColor, transition: 'width 0.6s ease',
              }} />
            </div>
          </div>
        )}

        {/* Market indices — renders nothing for a country the table has none for */}
        <RegionIndices country={country.name} />
        <RegionMarkets country={country.name} />

        {!info && (
          <div style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.08em' }}>
            — {t('panel.noData', 'No intelligence data available')} —
          </div>
        )}
      </div>
    )
  }

  // ── EVENTS ─────────────────────────────────────────────────────────────────
  if (tab === 'events') {
    return (
      <>
        <div style={{ padding: '10px 12px 6px' }}>
          {regionEvents.length === 0 ? (
            <div style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.08em', padding: '4px 0' }}>
              — {t('region.noEvents', 'No recent events')} —
            </div>
          ) : (
            regionEvents.map(e => {
              const sym = eventSymbol(e)
              return (
                <button
                  key={e.id}
                  onClick={() => onOpenEvent(e.id)}
                  title={eventTitle(e, i18n.language)}
                  style={{
                    display: 'flex', gap: '7px', alignItems: 'flex-start',
                    width: '100%', textAlign: 'left', marginBottom: '2px',
                    padding: '4px 5px', borderRadius: '3px',
                    background: 'transparent', border: '1px solid transparent',
                    cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                  onMouseEnter={ev => {
                    ev.currentTarget.style.background = 'rgba(0,180,255,0.06)'
                    ev.currentTarget.style.borderColor = 'rgba(0,180,255,0.18)'
                  }}
                  onMouseLeave={ev => {
                    ev.currentTarget.style.background = 'transparent'
                    ev.currentTarget.style.borderColor = 'transparent'
                  }}
                >
                  <span style={{
                    flexShrink: 0, fontSize: '10px', letterSpacing: '0.06em',
                    padding: '1px 4px', marginTop: '1px',
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    border: `1px ${sym.borderStyle} ${sym.borderColor}`,
                    background: sym.background, color: sym.color, borderRadius: '2px',
                  }}>
                    {sym.glyph} {sym.label}
                  </span>
                  <span style={{ color: '#8aabbf', fontSize: '11px', lineHeight: 1.4, flex: 1, minWidth: 0 }}>
                    {eventTitle(e, i18n.language)}
                  </span>
                  <span style={{ flexShrink: 0, color: '#2a4060', fontSize: '10px', marginTop: '2px' }}>
                    {ageFrom(sceneNow, e.published_at)}
                  </span>
                </button>
              )
            })
          )}
        </div>
        <RegionKeyActors regionEvents={regionEvents} addSelectedEntity={addSelectedEntity} />
      </>
    )
  }

  // ── PROFILE ────────────────────────────────────────────────────────────────
  return (
    <>
      {info && info.industries.length > 0 && (
        <div style={{ padding: '10px 12px 10px' }}>
          <SectionLabel>ECONOMIC STRUCTURE</SectionLabel>
          {info.industries.map((ind, i) => (
            <IndustryBar key={ind.label} label={ind.label} pct={ind.pct} color={BAR_COLORS[i % BAR_COLORS.length]} />
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid rgba(0,180,255,0.07)', padding: '9px 12px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.15em' }}>WIKIPEDIA</span>
          {wikiData?.content_urls?.desktop?.page && (
            <a
              href={wikiData.content_urls.desktop.page}
              target="_blank" rel="noreferrer"
              style={{ color: '#4a6fa5', fontSize: '10px', letterSpacing: '0.08em', textDecoration: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#00d4ff')}
              onMouseLeave={e => (e.currentTarget.style.color = '#4a6fa5')}
            >
              ↗ Read more
            </a>
          )}
        </div>
        {wikiLoading && (
          <div style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.08em' }}>↻ Loading…</div>
        )}
        {wikiData && !wikiLoading && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            {wikiData.thumbnail && (
              <img
                src={wikiData.thumbnail.source}
                alt={country.name}
                style={{
                  flexShrink: 0, width: '110px', height: '80px', objectFit: 'cover',
                  borderRadius: '3px', border: '1px solid rgba(0,180,255,0.1)',
                }}
              />
            )}
            <p style={{ color: '#7a9ab0', fontSize: '11px', lineHeight: 1.55, margin: 0, minWidth: 0 }}>
              {wikiData.extract.length > 420
                ? wikiData.extract.slice(0, 420).replace(/\s+\S*$/, '') + '…'
                : wikiData.extract}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
