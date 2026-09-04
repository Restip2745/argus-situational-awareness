/**
 * One question and its answer, wherever the agent is asked.
 *
 * Five panels rendered this by hand and each carried the same mistake: while
 * the answer streamed they showed the raw text, so the operator watched literal
 * `<p>` and `<li>` accumulate and then vanish when the last token landed and the
 * whole thing was finally parsed. What arrives is already sanitised now — the
 * hook does it per chunk — so there is one branch here rather than two, and an
 * unclosed tag is closed by the HTML parser on the way in, which is what it does
 * with any document that ends early.
 */
import type { AgentAnswer } from '../../hooks/useAgentQuery'

interface Props {
  entry:       AgentAnswer
  accentColor: string
  /** The popout column runs one size down from the docked panels. */
  compact?:    boolean
}

export function AgentAnswerBlock({ entry, accentColor, compact = false }: Props) {
  const bodyStyle = {
    color:      '#8aabbf',
    fontSize:   compact ? '10px' : '11px',
    lineHeight: compact ? 1.7 : 1.6,
    wordBreak:  'break-word' as const,
  }

  return (
    <div style={{ marginBottom: compact ? '10px' : '7px' }}>
      <div style={{
        color: accentColor, fontSize: '10px', letterSpacing: '0.08em',
        marginBottom: compact ? '4px' : '3px', opacity: 0.7,
      }}>
        ▸ {entry.question}
      </div>
      {entry.html ? (
        <div
          className={entry.streaming ? 'agent-response is-streaming' : 'agent-response'}
          dangerouslySetInnerHTML={{ __html: entry.html }}
          style={bodyStyle}
        />
      ) : (
        // Nothing has arrived yet. The cursor rides the text, so until there is
        // text this stands in for it.
        <div style={{ ...bodyStyle, color: '#2a4060' }}>●●●</div>
      )}
    </div>
  )
}
