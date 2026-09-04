import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { AgentAnswerBlock } from '../AgentAnswerBlock'
import type { AgentAnswer } from '../../../hooks/useAgentQuery'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === 'string' ? d : k), i18n: { language: 'en' } }),
}))

const answer = (over: Partial<AgentAnswer> = {}): AgentAnswer => ({
  kind: 'answer', id: 'a1', question: 'why', html: '', streaming: false, ...over,
})

describe('AgentAnswerBlock', () => {
  // The bug this replaces: the panels showed the raw stream as text, so the
  // reader watched literal markup accumulate and then disappear at the end.
  it('renders a partial answer as elements, not as markup', () => {
    const { container } = render(
      <AgentAnswerBlock entry={answer({ html: '<p>half a sen</p>', streaming: true })} accentColor="#00ffcc" />,
    )
    const body = container.querySelector('.agent-response')!
    expect(body.querySelector('p')).toBeTruthy()
    expect(body.textContent).toBe('half a sen')
    expect(body.textContent).not.toContain('<')
  })

  it('marks the block while it streams and stops when it lands', () => {
    // The cursor is a pseudo-element on this class, so the class is what says
    // whether an answer is still arriving.
    const { container, rerender } = render(
      <AgentAnswerBlock entry={answer({ html: '<p>x</p>', streaming: true })} accentColor="#00ffcc" />,
    )
    expect(container.querySelector('.agent-response.is-streaming')).toBeTruthy()

    rerender(<AgentAnswerBlock entry={answer({ html: '<p>x</p>', streaming: false })} accentColor="#00ffcc" />)
    expect(container.querySelector('.agent-response.is-streaming')).toBeNull()
    expect(container.querySelector('.agent-response')).toBeTruthy()
  })

  it('stands in for the text until the first token arrives', () => {
    const { container } = render(
      <AgentAnswerBlock entry={answer({ streaming: true })} accentColor="#00ffcc" />,
    )
    expect(container.querySelector('.agent-response')).toBeNull()
    expect(container.textContent).toContain('●●●')
  })

  it('shows the question above the answer', () => {
    const { container } = render(
      <AgentAnswerBlock entry={answer({ question: 'compare them', html: '<p>x</p>' })} accentColor="#00ffcc" />,
    )
    expect(container.textContent).toContain('compare them')
  })
})
