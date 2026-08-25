import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store'
import { BODY_MAP } from '../../data/celestialBodies'
import { resolveOrbitalPlacement } from '../../data/orbitalPlacement'
import type { BodyDef } from '../../data/celestialBodies'
import type { CelestialBodyName } from '../../types'

type AnimPhase = 'expanded' | 'collapsing' | 'collapsed' | 'expanding'

// ── Nav group metadata ────────────────────────────────────────────────────────
const GROUP_META: Record<string, { label: string; color: string }> = {
  asteroid: { label: 'Asteroids', color: '#a08870' },
  comet:    { label: 'Comets',    color: '#c8e8ff' },
}

export function CelestialNavList() {
  const { t } = useTranslation()
  const navLevel        = useAppStore((s) => s.navLevel)
  const navCandidates   = useAppStore((s) => s.navCandidates)
  const navCollapsed    = useAppStore((s) => s.navCollapsed)
  const setNavCollapsed = useAppStore((s) => s.setNavCollapsed)
  const focusedBody     = useAppStore((s) => s.focusedBody)
  const focusOn         = useAppStore((s) => s.focusOn)
  const setSelectedBody = useAppStore((s) => s.setSelectedBody)
  const resetToSolarView = useAppStore((s) => s.resetToSolarView)
  const events          = useAppStore((s) => s.events)
  const decorativeFx    = useAppStore((s) => s.decorativeFx)

  // Which nav groups are expanded (only used at solar level)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const ITEM_STAGGER = 35 // ms per item

  // ── Animation phase state machine ──────────────────────────
  const [phase, setPhase] = useState<AnimPhase>(navCollapsed ? 'collapsed' : 'expanded')

  useEffect(() => {
    if (navCollapsed && (phase === 'expanded' || phase === 'expanding')) {
      setPhase('collapsing')
      const total = navCandidates.length + 2
      const timer = setTimeout(() => setPhase('collapsed'), total * ITEM_STAGGER + 300)
      return () => clearTimeout(timer)
    }
    if (!navCollapsed && (phase === 'collapsed' || phase === 'collapsing')) {
      setPhase('expanding')
      const total = navCandidates.length + 2
      const timer = setTimeout(() => setPhase('expanded'), total * ITEM_STAGGER + 300)
      return () => clearTimeout(timer)
    }
  }, [navCollapsed]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Level-switch fade (only on actual level changes) ────────
  const [levelSwitchAnim, setLevelSwitchAnim] = useState(false)
  const prevLevelRef = useRef(navLevel)

  useEffect(() => {
    if (prevLevelRef.current !== navLevel) {
      prevLevelRef.current = navLevel
      setExpandedGroups(new Set()) // collapse groups on level change
      setLevelSwitchAnim(false)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setLevelSwitchAnim(true))
      })
    }
  }, [navLevel])

  useEffect(() => {
    if (levelSwitchAnim) {
      const timer = setTimeout(() => setLevelSwitchAnim(false), navCandidates.length * 30 + 300)
      return () => clearTimeout(timer)
    }
  }, [levelSwitchAnim, navCandidates.length])

  // Resolved rather than compared: `e.body` holds the model's prose ("Mars"),
  // while bodyId is a lowercase table id, so a direct equality test counted
  // zero events for every body the model happened to capitalise.
  function eventCountForBody(bodyId: CelestialBodyName): number {
    return events.filter((e) => {
      const placement = resolveOrbitalPlacement(e.body, e.location_label)
      return placement?.kind === 'body' && placement.body === bodyId
    }).length
  }

  function toggleGroup(groupKey: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const LEVEL_LABEL: Record<string, string> = {
    solar: 'SOLAR SYSTEM',
    orbital: 'ORBITAL',
    surface: 'SURFACE',
  }

  // ── Collapsed icon button ──────────────────────────────────
  if (phase === 'collapsed') {
    return (
      <button
        onClick={() => setNavCollapsed(false)}
        style={{ zIndex: 20 }}
        className="absolute right-4 bottom-16 w-8 h-8 flex items-center justify-center rounded border border-[rgba(0,180,255,0.12)] bg-[rgba(4,9,22,0.92)] text-argus-dim hover:text-argus-accent text-sm animate-nav-fade-in"
        title={t('celestialNav.expand', 'Celestial Navigation')}
      >
        &#x1F9ED;
      </button>
    )
  }

  const parentId  = focusedBody ? BODY_MAP.get(focusedBody)?.orbitParent : null
  const parentDef = parentId ? BODY_MAP.get(parentId) : null
  const isExpanding  = phase === 'expanding'
  const isCollapsing = phase === 'collapsing'

  // ── Build render items (flat + grouped) for solar level ──────────────────
  type RenderItem =
    | { kind: 'body'; def: BodyDef; visualIdx: number }
    | { kind: 'group-header'; groupKey: string; bodies: BodyDef[]; visualIdx: number }

  const renderItems: RenderItem[] = []

  if (navLevel === 'solar') {
    // Separate grouped and ungrouped bodies, preserving first-occurrence order for groups
    const seenGroups = new Set<string>()

    for (const body of navCandidates) {
      const g = body.navGroup
      if (g) {
        if (!seenGroups.has(g)) {
          seenGroups.add(g)
          const groupBodies = navCandidates.filter((b) => b.navGroup === g)
          // Header at first occurrence
          renderItems.push({ kind: 'group-header', groupKey: g, bodies: groupBodies, visualIdx: renderItems.length })
          // All members immediately after header (contiguous), only if expanded
          if (expandedGroups.has(g)) {
            for (const member of groupBodies) {
              renderItems.push({ kind: 'body', def: member, visualIdx: renderItems.length })
            }
          }
        }
        // Skip non-first occurrences — already handled above
      } else {
        renderItems.push({ kind: 'body', def: body, visualIdx: renderItems.length })
      }
    }
  } else {
    // Non-solar: no grouping
    for (const body of navCandidates) {
      renderItems.push({ kind: 'body', def: body, visualIdx: renderItems.length })
    }
  }

  const totalItems = renderItems.length

  function bodyItemDelay(visualIdx: number): number {
    if (isExpanding)  return (totalItems + 1 - visualIdx) * ITEM_STAGGER
    if (isCollapsing) return visualIdx * ITEM_STAGGER
    return 0
  }

  function bodyItemAnimation(visualIdx: number): string {
    // With decorative motion off the list still expands and collapses, it just
    // does so instantly instead of cascading.
    if (!decorativeFx) return 'none'
    if (isExpanding)  return `navExpandIn 0.3s ease ${bodyItemDelay(visualIdx)}ms both`
    if (isCollapsing) return `navCollapseOut 0.25s ease ${bodyItemDelay(visualIdx)}ms both`
    return 'none'
  }

  const upperDelay  = isExpanding ? 1 * ITEM_STAGGER : isCollapsing ? totalItems * ITEM_STAGGER : 0
  const upperAnim   = !decorativeFx ? 'none' : isExpanding
    ? `navExpandIn 0.3s ease ${upperDelay}ms both`
    : isCollapsing ? `navCollapseOut 0.25s ease ${upperDelay}ms both` : 'none'

  const footerDelay = isExpanding ? 0 : isCollapsing ? (totalItems + 1) * ITEM_STAGGER : 0
  const footerAnim  = !decorativeFx ? 'none' : isExpanding
    ? `navExpandIn 0.3s ease ${footerDelay}ms both`
    : isCollapsing ? `navCollapseOut 0.25s ease ${footerDelay}ms both` : 'none'

  return (
    <div style={{ zIndex: 20 }} className="absolute right-4 bottom-16 flex flex-col items-end gap-1">

      {/* ── Body list ───────────────────────────────────────────── */}
      <div className="flex flex-col items-end gap-0.5">
        {renderItems.map((item) => {
          if (item.kind === 'group-header') {
            const { groupKey, bodies } = item
            const meta = GROUP_META[groupKey]
            const isOpen = expandedGroups.has(groupKey)
            const evtCount = bodies.reduce((n, b) => n + eventCountForBody(b.id), 0)

            return (
              <button
                key={`group-${groupKey}`}
                onClick={() => toggleGroup(groupKey)}
                className="nav-body-item flex items-center gap-2 py-1 px-1 text-right group"
                style={{
                  animation: (isExpanding || isCollapsing)
                    ? bodyItemAnimation(item.visualIdx)
                    : (levelSwitchAnim && decorativeFx) ? `navItemIn 0.25s ease ${item.visualIdx * 30}ms both` : 'none',
                }}
              >
                {evtCount > 0 && (
                  <span className="text-[11px] font-mono text-[#ff9c2a] flex-shrink-0">{evtCount}</span>
                )}
                <span className="text-[10px] font-mono text-argus-dim group-hover:text-white transition-colors whitespace-nowrap tracking-wide">
                  {isOpen ? '▾' : '▸'} {meta.label}
                  <span className="ml-1 opacity-40">{bodies.length}</span>
                </span>
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: meta.color, opacity: 0.7 }}
                />
              </button>
            )
          }

          // kind === 'body'
          const body = item.def
          const isFocused = focusedBody === body.id
          const evtCount  = eventCountForBody(body.id)
          const isGrouped = !!body.navGroup

          return (
            <button
              key={body.id}
              onClick={() => { focusOn?.(body.id); setSelectedBody(body.id) }}
              className={`nav-body-item flex items-center gap-2 py-1 px-1 text-right group ${isFocused ? 'is-focused' : ''}`}
              style={{
                paddingRight: isGrouped ? '0' : undefined,
                animation: (isExpanding || isCollapsing)
                  ? bodyItemAnimation(item.visualIdx)
                  : (levelSwitchAnim && decorativeFx) ? `navItemIn 0.25s ease ${item.visualIdx * 30}ms both` : 'none',
              }}
            >
              {evtCount > 0 && (
                <span className="text-[11px] font-mono text-[#ff9c2a] flex-shrink-0">{evtCount}</span>
              )}

              {/* Indent grouped children */}
              {isGrouped && (
                <span className="text-[11px] text-argus-dim opacity-40 flex-shrink-0">└</span>
              )}

              <span
                className={`text-[11px] font-mono whitespace-nowrap ${
                  isFocused ? 'text-[#00d4ff]' : 'text-[#c8d6e5] group-hover:text-white'
                }`}
                style={{ transition: 'color 0.2s ease' }}
              >
                {body.label}
              </span>

              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 group-hover:scale-125"
                style={{
                  backgroundColor: body.color,
                  boxShadow: isFocused ? `0 0 8px ${body.color}` : 'none',
                  transition: 'box-shadow 0.3s ease, transform 0.2s ease',
                }}
              />
            </button>
          )
        })}
      </div>

      {/* ── Upper level link ─────────────────────────────────────── */}
      {navLevel !== 'solar' && (
        <button
          onClick={() => parentDef ? focusOn?.(parentDef.id) : resetToSolarView?.()}
          className="nav-body-item flex items-center gap-1.5 text-right group mt-1 py-1 px-1"
          style={{ animation: upperAnim }}
        >
          <span className="text-[10px] font-mono text-argus-dim group-hover:text-argus-accent transition-colors tracking-wide uppercase">
            &#x25C2; {parentDef ? parentDef.label : 'SOLAR SYSTEM'}
          </span>
        </button>
      )}

      {/* ── Footer: level label + collapse button ────────────────── */}
      <div
        className="flex items-center gap-2 mt-1 border-t border-[rgba(0,180,255,0.08)] pt-1.5"
        style={{ animation: footerAnim }}
      >
        <span className="text-[11px] font-mono tracking-[0.15em] text-argus-dim uppercase">
          {LEVEL_LABEL[navLevel] ?? navLevel}
        </span>
        <button
          onClick={() => setNavCollapsed(true)}
          className="text-argus-dim hover:text-argus-accent text-[10px] transition-colors leading-none"
          title={t('celestialNav.collapse', 'Collapse')}
        >
          &#x2715;
        </button>
      </div>
    </div>
  )
}
