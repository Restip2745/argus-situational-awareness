import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { entityQueries } from '../../lib/suggestedQueries'
import { useAppStore } from '../../store'
import { usePanelDrag } from '../../hooks/usePanelDrag'
import { useAgentQuery, awaitingFirstToken } from '../../hooks/useAgentQuery'
import { AgentAnswerBlock } from './AgentAnswerBlock'
import { SubjectAddedNote } from './SubjectAddedNote'
import { usePopoutWindow } from '../../hooks/usePopoutWindow'
import { getCachedWikiSummary, useWikiCacheVersion } from '../../hooks/useWikiSummary'
import { useWikiSearch } from '../../hooks/useWikiSearch'
import { Panel } from './Panel'
import { WikiPanelBody } from './WikiPanelBody'
import { wikiContextEntity } from '../../lib/contextEntity'

const ACCENT = '#c084fc'

/** Encyclopedia text for an entity, trimmed to something a prompt can carry. */
function wikiExtract(title: string | null | undefined): string | null {
  const extract = getCachedWikiSummary(title)?.extract?.trim()
  if (!extract) return null
  return extract.length > 400 ? extract.slice(0, 400).replace(/\s+\S*$/, '') + '…' : extract
}

export function WikiPanel() {
  const { t, i18n } = useTranslation()
  const selectedEntities = useAppStore(s => s.selectedEntities)
  const addSelectedEntity = useAppStore(s => s.addSelectedEntity)
  const removeSelectedEntity = useAppStore(s => s.removeSelectedEntity)
  const clearSelectedEntities = useAppStore(s => s.clearSelectedEntities)

  const addContextEntity    = useAppStore(s => s.addContextEntity)
  const contextEntities     = useAppStore(s => s.contextEntities)

  const { panelRef, pos, setPos, dragging, onHeaderMouseDown, zIndex, handleBringToFront, uiScale } =
    usePanelDrag({ panelKey: 'wiki', defaultPos: { x: 60, y: 120 } })

  const [searchInput, setSearchInput] = useState('')
  const [showSearch, setShowSearch] = useState(true)
  // Same ladder the mention list uses: the query is typed in the language the
  // interface is in, and en is the fallback because it has far more articles.
  const searchLangs = useMemo(
    () => i18n.language?.startsWith('zh') ? ['zh', 'en'] : ['en'],
    [i18n.language],
  )
  const { results: searchResults, loading: searchLoading } = useWikiSearch(searchInput, searchLangs, 8)
  // Extracts are fetched by the body components below; this re-renders us when
  // they arrive so the prompt text is built from the real thing.
  const wikiFetchGen = useWikiCacheVersion()

  // The subject here is the whole set, not one entity — the answers were
  // reasoned over whichever entities were collected at the time, so adding or
  // removing one makes the standing transcript describe a different question.
  const { history, loading: agentLoading, error: agentError, ask } =
    useAgentQuery(selectedEntities.map(p => ({ id: p.name, label: p.name })))
  const { open: popoutOpen, isPopped } = usePopoutWindow('wiki')
  const [agentInput, setAgentInput] = useState('')
  const agentScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    agentScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [history])

  useEffect(() => {
    const onResize = () => {
      setPos(p => ({
        x: Math.max(0, Math.min(window.innerWidth / uiScale - 340, p.x)),
        y: Math.max(0, Math.min(window.innerHeight / uiScale - 60, p.y)),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [uiScale, setPos])

  const agentContext = useMemo(() => {
    if (selectedEntities.length === 0) return ''
    return selectedEntities.map(p => {
      const extract = wikiExtract(p.wikiTitle ?? p.name)
      return `Entity: ${p.name}${extract ? `\n${extract}` : ''}`
    }).join('\n\n')
    // The extracts arrive asynchronously, so recompute once they land rather
    // than freezing the name-only version captured on first render.
  }, [selectedEntities, wikiFetchGen])

  const suggestedQueries = useMemo(
    () => entityQueries(t, selectedEntities.map((p) => p.name)),
    [selectedEntities, t],
  )

  if (selectedEntities.length === 0) return null

  const handleSend = () => {
    if (agentInput.trim()) { ask(agentInput, agentContext); setAgentInput('') }
  }

  return (
    <Panel
      panelRef={panelRef}
      accentColor={ACCENT}
      onMouseDown={handleBringToFront}
      dragging={dragging}
      onHeaderMouseDown={onHeaderMouseDown}
      title={
        <span style={{ color: ACCENT }}>
          {selectedEntities.length > 1
            ? `◈ ${t('wiki.titlePlural', 'ENTITIES')} (${selectedEntities.length})`
            : `◈ ${t('wiki.title', 'ENTITY')}`}
        </span>
      }
      headerControls={
        <>
          {/* Add entities to context */}
          {(() => {
            const allInContext = selectedEntities.every(p => contextEntities.some(e => e.id === `wiki-${p.name}`))
            return (
              <button
                onClick={() => {
                  for (const p of selectedEntities) {
                    // The actual encyclopedia text, not a label. This used to
                    // send `Wikipedia: <name>`, so the cross-entity agent was
                    // asked to relate people it had been told nothing about.
                    addContextEntity(wikiContextEntity(p.name, wikiExtract(p.wikiTitle ?? p.name)))
                  }
                }}
                aria-label={allInContext ? 'Already in context' : 'Add to context panel'}
                title={allInContext ? 'Already in context' : 'Add to context panel'}
                disabled={allInContext}
                style={{
                  background: allInContext ? 'rgba(0,255,204,0.12)' : 'none',
                  border: `1px solid ${allInContext ? 'rgba(0,255,204,0.4)' : 'transparent'}`,
                  borderRadius: '2px',
                  color: allInContext ? '#00ffcc' : '#4a6070',
                  cursor: allInContext ? 'default' : 'pointer',
                  fontSize: '11px', lineHeight: 1,
                  padding: '1px 4px', transition: 'all 0.15s',
                  fontFamily: 'JetBrains Mono, monospace',
                  opacity: allInContext ? 0.6 : 1,
                }}
              >⊕</button>
            )
          })()}
          <button
            onClick={() => setShowSearch(v => !v)}
            aria-label={t('wiki.search', 'Search Wikipedia')}
            title={t('wiki.search', 'Search Wikipedia')}
            style={{
              background: showSearch ? `${ACCENT}18` : 'none',
              border: `1px solid ${showSearch ? ACCENT + '40' : 'transparent'}`,
              borderRadius: '2px', color: showSearch ? ACCENT : '#4a6070',
              cursor: 'pointer', fontSize: '11px', padding: '2px 5px',
              fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
              transition: 'all 0.15s',
            }}
          >⌕</button>
          <button
            onClick={popoutOpen}
            aria-label={isPopped ? 'Panel is open in separate window' : 'Pop out to separate window'}
            title={isPopped ? 'Panel is open in separate window' : 'Pop out to separate window'}
            style={{
              background: 'none', border: 'none',
              color: isPopped ? ACCENT : '#4a6070',
              cursor: 'pointer', fontSize: '10px', lineHeight: 1,
              padding: '1px 3px', transition: 'color 0.15s',
            }}
          >⊡</button>
        </>
      }
      onClose={clearSelectedEntities}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex,
        width: '320px',
        maxHeight: `calc(${100 / uiScale}vh - 100px)`,
      }}
    >
      {/* Search bar */}
      {showSearch && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,180,255,0.08)' }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t('wiki.searchPlaceholder', 'Search Wikipedia…')}
            style={{
              width: '100%', background: 'rgba(0,180,255,0.05)', border: `1px solid ${ACCENT}25`,
              borderRadius: '3px', color: '#a8c4d8', fontSize: '11px', padding: '5px 8px',
              fontFamily: 'JetBrains Mono, monospace', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {searchLoading && (
            <div style={{ color: '#2a4060', fontSize: '10px', padding: '4px 0', letterSpacing: '0.1em' }}>{t('wiki.loading', '↻ Loading…')}</div>
          )}
          {searchResults.length > 0 && (
            <div style={{ marginTop: '4px', maxHeight: '140px', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,180,255,0.15) transparent' }}>
              {searchResults.map(r => {
                const isSelected = selectedEntities.some(p => p.name === r.title)
                return (
                  <button
                    key={r.pageid}
                    onClick={() => {
                      if (!isSelected) addSelectedEntity({ name: r.title, wikiTitle: r.title })
                      setSearchInput('')
                    }}
                    disabled={isSelected}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: isSelected ? `${ACCENT}0a` : 'transparent',
                      border: 'none', padding: '4px 6px', cursor: isSelected ? 'default' : 'pointer',
                      borderBottom: '1px solid rgba(0,180,255,0.05)',
                      fontFamily: 'JetBrains Mono, monospace', transition: 'background 0.1s',
                      opacity: isSelected ? 0.5 : 1,
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${ACCENT}10` }}
                    onMouseLeave={e => { e.currentTarget.style.background = isSelected ? `${ACCENT}0a` : 'transparent' }}
                  >
                    <div style={{ color: '#c8dde8', fontSize: '11px', fontWeight: 600 }}>{r.title}</div>
                    {r.snippet && (
                      <div style={{ color: '#4a6070', fontSize: '10px', marginTop: '1px', lineHeight: 1.3 }}>
                        {r.snippet.length > 100 ? r.snippet.slice(0, 100) + '…' : r.snippet}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Scrollable person cards */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,180,255,0.15) transparent' }}>
        {selectedEntities.map(p => (
          <WikiPanelBody
            key={p.name}
            entity={p}
            accentColor={ACCENT}
            onRemove={selectedEntities.length > 1 ? () => removeSelectedEntity(p.name) : undefined}
          />
        ))}
      </div>

      {/* AI Agent section */}
      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(0,180,255,0.1)', background: 'rgba(4,9,22,0.97)' }}>
        {/* Suggested queries */}
        {suggestedQueries.length > 0 && (
          <div style={{ padding: '7px 12px 5px', borderBottom: '1px solid rgba(0,180,255,0.07)' }}>
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
            {t('wiki.agent', '◈ ENTITY INTELLIGENCE')}
          </div>

          {history.length > 0 && (
            <div style={{
              marginBottom: '7px', maxHeight: '180px', overflowY: 'auto',
              scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,180,255,0.15) transparent',
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
            <input
              value={agentInput}
              onChange={e => setAgentInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={t('wiki.askAgent', 'Ask about this entity…')}
              disabled={agentLoading}
              style={{
                flex: 1, background: 'rgba(0,180,255,0.05)', border: `1px solid ${ACCENT}25`,
                borderRadius: '3px', color: '#a8c4d8', fontSize: '11px', padding: '5px 8px',
                fontFamily: 'JetBrains Mono, monospace', outline: 'none',
                opacity: agentLoading ? 0.5 : 1,
              }}
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
