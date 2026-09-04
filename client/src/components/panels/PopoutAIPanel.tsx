/**
 * PopoutAIPanel — dedicated AI intelligence agent column for popout windows.
 *
 * Renders in the right column of the 2-column popout layout.
 * Accepts a context summary string from the left panel so the agent
 * has full situational awareness of the displayed data.
 */
import { useRef, useState, useEffect } from 'react'
import { useAgentQuery, awaitingFirstToken, type AgentSubject } from '../../hooks/useAgentQuery'
import { AgentAnswerBlock } from './AgentAnswerBlock'
import { SubjectAddedNote } from './SubjectAddedNote'

interface Props {
  /** Contextual summary passed to the agent (event or region data). */
  agentContext: string
  /** Suggested quick-launch queries shown as chips. */
  suggestedQueries?: string[]
  /** Panel title label (e.g. "EVENT AGENT" or "REGION AGENT"). */
  label?: string
  /**
   * What the conversation is about. The popout follows the main window, so its
   * subject changes underneath it when the operator navigates there; without
   * this the transcript would outlive the thing it was about. Collections are
   * passed entity by entity so that one joining the set reads as growth rather
   * than as a different subject entirely.
   */
  subject?: string | readonly AgentSubject[]
}


export function PopoutAIPanel({ agentContext, suggestedQueries = [], label = 'INTELLIGENCE AGENT', subject }: Props) {
  const { history, loading, error, ask, clear } = useAgentQuery(subject)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [history])

  const handleSend = () => {
    if (!input.trim() || loading) return
    ask(input.trim(), agentContext)
    setInput('')
  }

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100%',
      background:    'rgba(4,9,22,0.97)',
      borderLeft:    '1px solid rgba(0,180,255,0.12)',
      fontFamily:    'JetBrains Mono, monospace',
    }}>
      {/* Header */}
      <div style={{
        padding:      '10px 14px',
        borderBottom: '1px solid rgba(0,180,255,0.1)',
        background:   'linear-gradient(90deg, rgba(0,212,255,0.06) 0%, transparent 100%)',
        display:      'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink:   0,
      }}>
        <span style={{ color: '#00d4ff', fontSize: '11px', letterSpacing: '0.15em' }}>◈ {label}</span>
        {history.length > 0 && (
          <button
            onClick={clear}
            title="Clear history"
            style={{
              background: 'none', border: 'none',
              color: '#2a4060', cursor: 'pointer',
              fontSize: '10px', letterSpacing: '0.1em',
              fontFamily: 'JetBrains Mono, monospace',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#4a6070' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#2a4060' }}
          >CLEAR</button>
        )}
      </div>

      {/* Suggested queries */}
      {suggestedQueries.length > 0 && (
        <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid rgba(0,180,255,0.07)', flexShrink: 0 }}>
          <div style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.15em', marginBottom: '6px' }}>SUGGESTED</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {suggestedQueries.map((q) => (
              <button
                key={q}
                onClick={() => { setInput(q); ask(q, agentContext) }}
                style={{
                  background:   'rgba(0,212,255,0.05)',
                  border:       '1px solid rgba(0,212,255,0.18)',
                  borderRadius: '2px', color: '#4a90b8',
                  fontSize: '10px', padding: '3px 8px',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                  letterSpacing: '0.05em', transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(0,212,255,0.12)'; el.style.color = '#00d4ff' }}
                onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(0,212,255,0.05)'; el.style.color = '#4a90b8' }}
              >{q}</button>
            ))}
          </div>
        </div>
      )}

      {/* Chat history */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minHeight: 0, scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,180,255,0.15) transparent' }}>
        {history.length === 0 && !loading && (
          <div style={{ color: '#2a4060', fontSize: '11px', letterSpacing: '0.08em', textAlign: 'center', marginTop: '24px' }}>
            Ask the intelligence agent about this data.
          </div>
        )}
        {history.map((entry) => entry.kind === 'subject-added'
          ? <SubjectAddedNote key={entry.id} labels={entry.labels} accentColor="#00d4ff" />
          : <AgentAnswerBlock key={entry.id} entry={entry} accentColor="#00d4ff" compact />)}
        {loading && awaitingFirstToken(history) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#2a4060', fontSize: '10px', letterSpacing: '0.15em' }}>ANALYZING</span>
            <span className="agent-loading-dots"><span /><span /><span /></span>
          </div>
        )}
        {error && (
          <div style={{ color: '#ff4d4d', fontSize: '11px', marginBottom: '6px', letterSpacing: '0.06em' }}>⚠ {error}</div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(0,180,255,0.1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Ask intelligence analysis..."
            disabled={loading}
            style={{
              flex: 1,
              background:   'rgba(0,180,255,0.05)',
              border:       '1px solid rgba(0,180,255,0.2)',
              borderRadius: '3px',
              color:        '#a8c4d8',
              fontSize:     '10px',
              padding:      '7px 10px',
              fontFamily:   'JetBrains Mono, monospace',
              outline:      'none',
              opacity:      loading ? 0.5 : 1,
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            style={{
              background:   loading ? 'rgba(0,212,255,0.04)' : 'rgba(0,212,255,0.08)',
              border:       '1px solid rgba(0,212,255,0.25)',
              borderRadius: '3px',
              color:        loading ? '#2a4060' : '#00d4ff',
              fontSize:     '10px',
              padding:      '7px 12px',
              cursor:       loading ? 'wait' : 'pointer',
              fontFamily:   'JetBrains Mono, monospace',
              letterSpacing:'0.08em',
              transition:   'all 0.15s',
            }}
          >{loading ? '…' : '↵'}</button>
        </div>
      </div>
    </div>
  )
}
