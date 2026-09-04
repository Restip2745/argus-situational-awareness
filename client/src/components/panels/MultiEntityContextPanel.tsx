import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { contextQueries } from '../../lib/suggestedQueries'
import { useAppStore } from '../../store'
import { usePanelDrag } from '../../hooks/usePanelDrag'
import { useAgentQuery, awaitingFirstToken } from '../../hooks/useAgentQuery'
import { ensureWikiSummary, getCachedWikiSummary } from '../../hooks/useWikiSummary'
import { mentionCandidates, searchedCandidates, candidateEntity, type MentionCandidate } from '../../lib/mentionCandidates'
import { useWikiSearch } from '../../hooks/useWikiSearch'
import { MentionInput } from '../ui/MentionInput'
import { AgentAnswerBlock } from './AgentAnswerBlock'
import { SubjectAddedNote } from './SubjectAddedNote'
import { usePopoutWindow } from '../../hooks/usePopoutWindow'
import { useCachedEntityKind } from '../../hooks/useEntityKind'
import { EntityKindGlyph } from './EntityGlyph'
import { Panel } from './Panel'
import type { ContextEntity, ContextEntityType } from '../../types'

const ACCENT = '#00ffcc'
const LIMIT = 8

const SINGLE_W = 340
const CARD_GAP  = 6
const H_PAD     = 20
// card content width when single entity; multi-column cards match this
const CARD_W    = SINGLE_W - H_PAD

/**
 * `wiki` is absent on purpose: a card from the entity panel is whatever the
 * entity turned out to be, so its glyph comes from `ENTITY_GLYPH` instead. The
 * other three types are fixed by the panel that produced them.
 */
const TYPE_ICON: Record<Exclude<ContextEntityType, 'wiki'>, string> = {
  event:     '◉',
  region:    '⊙',
  celestial: '✦',
}

const TYPE_COLOR: Record<ContextEntityType, string> = {
  event:     '#ff9c2a',
  wiki:      '#c084fc',
  region:    '#00d4ff',
  celestial: '#ffd700',
}

export function EntityCard({ entity, onRemove }: { entity: ContextEntity; onRemove: () => void }) {
  const color = TYPE_COLOR[entity.type]
  // Looked up for wiki cards only, but the hook has to run either way.
  const wikiKind = useCachedEntityKind(entity.type === 'wiki' ? entity.name : null)
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px',
      padding: '6px 8px', background: `${color}08`,
      border: `1px solid ${color}20`, borderRadius: '3px',
    }}>
      <span style={{ color, fontSize: '10px', flexShrink: 0, marginTop: '1px' }}>
        {entity.type === 'wiki'
          ? <EntityKindGlyph kind={wikiKind} />
          : TYPE_ICON[entity.type]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#c8dde8', fontSize: '11px', fontWeight: 600, lineHeight: 1.3 }}>
          {entity.name}
        </div>
        {entity.summary && (
          <div style={{
            color: '#4a6070', fontSize: '10px', lineHeight: 1.4, marginTop: '2px',
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {entity.summary}
          </div>
        )}
        <div style={{
          color: `${color}99`, fontSize: '10px', letterSpacing: '0.1em',
          marginTop: '2px', textTransform: 'uppercase',
        }}>
          {entity.type}
        </div>
      </div>
      <button
        onClick={onRemove}
        style={{
          background: 'none', border: 'none', color: '#4a6070',
          cursor: 'pointer', fontSize: '11px', lineHeight: 1,
          padding: '1px 3px', flexShrink: 0, transition: 'color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#ff4d4d' }}
        onMouseLeave={e => { e.currentTarget.style.color = '#4a6070' }}
      >✕</button>
    </div>
  )
}

export function MultiEntityContextPanel() {
  const { t, i18n } = useTranslation()
  const contextEntities     = useAppStore(s => s.contextEntities)
  const showContextPanel    = useAppStore(s => s.showContextPanel)
  const removeContextEntity = useAppStore(s => s.removeContextEntity)
  const clearContextEntities = useAppStore(s => s.clearContextEntities)
  const addContextEntity    = useAppStore(s => s.addContextEntity)
  const events              = useAppStore(s => s.events)

  const { panelRef, pos, setPos, dragging, onHeaderMouseDown, zIndex, handleBringToFront, uiScale } =
    usePanelDrag({ panelKey: 'context', defaultPos: { x: 100, y: 160 } })

  const { open: popoutOpen, isPopped } = usePopoutWindow('context')
  // Same rule as the entity panel: the collection is the subject. Passed as the
  // entities themselves, not a joined key, so the hook can tell a card being
  // added from the collection being replaced.
  const { history, loading: agentLoading, error: agentError, ask } =
    useAgentQuery(contextEntities.map(e => ({ id: e.id, label: e.name })))
  const [agentInput, setAgentInput] = useState('')
  const agentScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    agentScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [history])

  const maxAvailW  = typeof window !== 'undefined' ? window.innerWidth - 100 : 900
  const columns    = contextEntities.length <= 1
    ? 1
    : Math.min(
        Math.floor((maxAvailW + CARD_GAP) / (CARD_W + CARD_GAP)),
        contextEntities.length,
      )
  const panelWidth = contextEntities.length <= 1
    ? SINGLE_W
    : Math.min(maxAvailW, columns * CARD_W + (columns - 1) * CARD_GAP + H_PAD)

  useEffect(() => {
    const onResize = () => {
      setPos(p => ({
        x: Math.max(0, Math.min(window.innerWidth / uiScale - panelWidth, p.x)),
        y: Math.max(0, Math.min(window.innerHeight / uiScale - 60, p.y)),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [uiScale, setPos, panelWidth])

  const agentContext = useMemo(() => {
    if (contextEntities.length === 0) return ''
    return contextEntities.map(e =>
      `[${e.type.toUpperCase()}] ${e.name}: ${e.summary}`
    ).join('\n\n')
  }, [contextEntities])

  const suggestedQueries = useMemo(
    () => contextQueries(t, contextEntities),
    [contextEntities, t],
  )

  const candidates = useMemo(
    () => mentionCandidates(events, i18n.language),
    [events, i18n.language],
  )
  const collected = useMemo(
    () => new Set(contextEntities.map(e => e.id)),
    [contextEntities],
  )

  // The mention token currently being typed, which the input reports up so the
  // search can run here rather than inside a text field.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  // The query was typed in the interface language, so ask that Wikipedia first
  // and fall through to en, which has far more articles.
  const searchLangs = useMemo(
    () => i18n.language?.startsWith('zh') ? ['zh', 'en'] : ['en'],
    [i18n.language],
  )
  const { results: searchHits, loading: searching } = useWikiSearch(mentionQuery ?? '', searchLangs)
  const searched = useMemo(
    () => searchedCandidates(searchHits.map(h => h.title)),
    [searchHits],
  )

  if (!showContextPanel) return null

  const handleSend = () => {
    if (agentInput.trim()) { ask(agentInput, agentContext); setAgentInput('') }
  }

  /**
   * An actor is a name, and the collection wants the encyclopedia text behind
   * it — the same text the entity panel would have fetched had the operator
   * gone the long way round. So the card lands when that resolves, not when the
   * key is pressed. Regions and events carry their summary already and appear
   * at once.
   */
  const handlePick = (candidate: MentionCandidate) => {
    if (candidate.entity) { addContextEntity(candidate.entity); return }
    const cached = getCachedWikiSummary(candidate.name)
    if (cached) { addContextEntity(candidateEntity(candidate, cached.extract)); return }
    ensureWikiSummary(candidate.name)
      .then(s => addContextEntity(candidateEntity(candidate, s?.extract)))
      .catch(() => addContextEntity(candidateEntity(candidate)))
  }

  const atLimit = contextEntities.length >= LIMIT
  const useGrid = contextEntities.length >= 2

  return (
    <Panel
      panelRef={panelRef}
      accentColor={ACCENT}
      onMouseDown={handleBringToFront}
      dragging={dragging}
      onHeaderMouseDown={onHeaderMouseDown}
      title={
        <span style={{ color: ACCENT }}>
          ◈ {t('context.title', 'MULTI-ENTITY CONTEXT')} ({contextEntities.length}/{LIMIT})
        </span>
      }
      headerControls={
        <>
          <button
            onClick={clearContextEntities}
            title={t('context.clearAll', 'Clear all entities')}
            style={{
              background: 'none', border: '1px solid rgba(255,77,77,0.25)',
              borderRadius: '2px', color: '#4a6070',
              cursor: 'pointer', fontSize: '10px', padding: '2px 5px',
              fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff4d4d'; e.currentTarget.style.borderColor = 'rgba(255,77,77,0.5)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#4a6070'; e.currentTarget.style.borderColor = 'rgba(255,77,77,0.25)' }}
          >⊘ {t('context.clear', 'CLEAR')}</button>
          <button
            onClick={popoutOpen}
            title={isPopped ? 'Panel is open in separate window' : 'Pop out to separate window'}
            style={{ background: 'none', border: 'none', color: isPopped ? ACCENT : '#4a6070', cursor: 'pointer', fontSize: '11px', lineHeight: 1 }}
          >⊡</button>
        </>
      }
      onClose={() => useAppStore.getState().setShowContextPanel(false)}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex,
        width: `${panelWidth}px`,
        maxHeight: `calc(${100 / uiScale}vh - 100px)`,
      }}
    >
      {/* Entity list */}
      <div style={{
        flex: 1, overflowY: 'auto', minHeight: 0, padding: '8px 10px',
        display: useGrid ? 'grid' : 'flex',
        ...(useGrid
          ? { gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '6px' }
          : { flexDirection: 'column' as const, gap: '4px' }),
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,255,204,0.15) transparent',
      }}>
        {contextEntities.map(entity => (
          <EntityCard
            key={entity.id}
            entity={entity}
            onRemove={() => removeContextEntity(entity.id)}
          />
        ))}

        {/* The panel used to refuse to render while empty, which left the
            mention box — the one way in that does not start from something
            already on screen — with nowhere to be typed. */}
        {contextEntities.length === 0 && (
          <div style={{
            color: '#4a6070', fontSize: '10px', lineHeight: 1.6,
            letterSpacing: '0.06em', padding: '10px 2px', textAlign: 'center',
          }}>
            {t('context.empty', 'Nothing collected yet — type @ below to name an entity.')}
          </div>
        )}

        {atLimit && (
          <div style={{
            color: '#ff9c2a', fontSize: '10px', letterSpacing: '0.1em',
            textAlign: 'center', padding: '4px 0',
            ...(useGrid && { gridColumn: '1 / -1' }),
          }}>
            {t('context.limitReached', 'ENTITY LIMIT REACHED')} ({LIMIT})
          </div>
        )}
      </div>

      {/* AI Agent section */}
      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(0,255,204,0.1)', background: 'rgba(4,9,22,0.97)' }}>
        {/* Suggested queries */}
        {suggestedQueries.length > 0 && (
          <div style={{ padding: '7px 12px 5px', borderBottom: '1px solid rgba(0,255,204,0.07)' }}>
            <div style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.15em', marginBottom: '5px' }}>
              {t('event.labels.suggestedQueries', 'SUGGESTED QUERIES')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {suggestedQueries.map(q => (
                <button
                  key={q}
                  onClick={() => { setAgentInput(q); ask(q, agentContext) }}
                  style={{
                    background: `${ACCENT}08`, border: `1px solid ${ACCENT}20`,
                    borderRadius: '2px', color: `${ACCENT}bb`, fontSize: '10px',
                    padding: '3px 7px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
                    letterSpacing: '0.05em', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${ACCENT}14`; e.currentTarget.style.color = ACCENT }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${ACCENT}08`; e.currentTarget.style.color = `${ACCENT}bb` }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat */}
        <div style={{ padding: '7px 12px 10px' }}>
          <div style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.15em', marginBottom: '5px' }}>
            {t('context.agent', '◈ CROSS-ENTITY INTELLIGENCE')}
          </div>

          {history.length > 0 && (
            <div style={{
              marginBottom: '7px', maxHeight: '180px', overflowY: 'auto',
              scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,255,204,0.15) transparent',
            }}>
              {history.map(entry => entry.kind === 'subject-added' ? (
                <SubjectAddedNote key={entry.id} labels={entry.labels} accentColor={ACCENT} />
              ) : (
                <AgentAnswerBlock key={entry.id} entry={entry} accentColor={ACCENT} />
              ))}
              <div ref={agentScrollRef} />
            </div>
          )}

          {agentLoading && awaitingFirstToken(history) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
              <span style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.15em' }}>
                {t('event.labels.analyzing', 'ANALYZING')}
              </span>
              <span className="agent-loading-dots"><span /><span /><span /></span>
            </div>
          )}

          {agentError && (
            <div style={{ color: '#ff4d4d', fontSize: '10px', marginBottom: '5px', letterSpacing: '0.06em' }}>⚠ {agentError}</div>
          )}

          <div style={{ display: 'flex', gap: '5px' }}>
            <MentionInput
              value={agentInput}
              onChange={setAgentInput}
              onSubmit={handleSend}
              candidates={candidates}
              extra={searched}
              searching={searching}
              onQuery={setMentionQuery}
              collected={collected}
              onPick={handlePick}
              full={atLimit}
              placeholder={t('context.askAgent', '詢問跨實體情報分析…')}
              disabled={agentLoading}
              accentColor={ACCENT}
            />
            <button
              onClick={handleSend}
              disabled={agentLoading || !agentInput.trim()}
              style={{
                background: agentLoading ? `${ACCENT}06` : `${ACCENT}0a`,
                border: `1px solid ${ACCENT}25`, borderRadius: '3px',
                color: agentLoading ? '#2a4060' : ACCENT, fontSize: '11px',
                padding: '5px 10px', cursor: agentLoading ? 'wait' : 'pointer',
                fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
                transition: 'all 0.15s',
              }}
            >
              {agentLoading ? '…' : '↵'}
            </button>
          </div>
        </div>
      </div>
    </Panel>
  )
}
