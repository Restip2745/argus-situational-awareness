import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAgentQuery, type AgentAnswer, type AgentEntry } from '../useAgentQuery'

const answers = (h: AgentEntry[]) => h.filter((e): e is AgentAnswer => e.kind === 'answer')

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c))
      ctrl.close()
    },
  })
}

function sseChunk(text: string) { return `data: ${JSON.stringify({ text })}\n\n` }
function sseDone() { return 'data: [DONE]\n\n' }

describe('useAgentQuery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts in idle state', () => {
    const { result } = renderHook(() => useAgentQuery())
    expect(result.current.history).toHaveLength(0)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('clear() resets history and error', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: makeStream([sseChunk('response text'), sseDone()]),
    } as unknown as Response)

    const { result } = renderHook(() => useAgentQuery())
    await act(async () => { await result.current.ask('q', 'ctx') })
    expect(result.current.history).toHaveLength(1)

    act(() => result.current.clear())
    expect(result.current.history).toHaveLength(0)
    expect(result.current.error).toBeNull()
  })

  it('sets error when server returns non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false, status: 500,
    } as unknown as Response)

    const { result } = renderHook(() => useAgentQuery())
    await act(async () => { await result.current.ask('q', 'ctx') })
    expect(result.current.error).toMatch(/HTTP 500/)
    expect(result.current.history).toHaveLength(0)
  })

  it('truncates context > 8000 chars before sending', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: makeStream([sseChunk('ok'), sseDone()]),
    } as unknown as Response)

    const longContext = 'x'.repeat(9000)
    const { result } = renderHook(() => useAgentQuery())
    await act(async () => { await result.current.ask('q', longContext) })

    const callBody = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(callBody.context.length).toBeLessThanOrEqual(8000)
  })

  it('marks entry streaming: false after stream completes', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: makeStream([sseChunk('hello '), sseChunk('world'), sseDone()]),
    } as unknown as Response)

    const { result } = renderHook(() => useAgentQuery())
    await act(async () => { await result.current.ask('q', '') })
    expect(result.current.history).toHaveLength(1)
    expect(answers(result.current.history)[0].streaming).toBe(false)
  })

  it('appends stream-interrupted-notice when [DONE] not received', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: makeStream([sseChunk('partial'), /* no [DONE] */]),
    } as unknown as Response)

    const { result } = renderHook(() => useAgentQuery())
    await act(async () => { await result.current.ask('q', '') })
    expect(answers(result.current.history)[0].html).toContain('stream-interrupted-notice')
  })
})

/**
 * Subject isolation.
 *
 * Not about leakage — the server sends only a system prompt and one user
 * message, so the model never sees earlier turns and answers each question in
 * isolation regardless. It is about the transcript reading as a conversation:
 * left standing across a switch, the second answer looks like it followed from
 * the first when it was asked with only the new subject's context.
 */
describe('useAgentQuery — subject isolation', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  const answered = () => vi.mocked(fetch).mockResolvedValue({
    ok: true, body: makeStream([sseChunk('answer'), sseDone()]),
  } as unknown as Response)

  it('keeps the transcript across re-renders with the same subject', async () => {
    answered()
    const { result, rerender } = renderHook(({ k }) => useAgentQuery(k), {
      initialProps: { k: 'usa' },
    })
    await act(async () => { await result.current.ask('q', 'ctx') })
    expect(result.current.history).toHaveLength(1)

    rerender({ k: 'usa' })
    expect(result.current.history).toHaveLength(1)
  })

  it('discards the transcript when the subject changes', async () => {
    answered()
    const { result, rerender } = renderHook(({ k }) => useAgentQuery(k), {
      initialProps: { k: 'usa' },
    })
    await act(async () => { await result.current.ask('q', 'ctx') })
    expect(result.current.history).toHaveLength(1)

    act(() => { rerender({ k: 'russia' }) })
    expect(result.current.history).toHaveLength(0)
    expect(result.current.error).toBeNull()
  })

  it('does not clear on first mount', () => {
    const { result } = renderHook(() => useAgentQuery('usa'))
    expect(result.current.history).toHaveLength(0)
    expect(result.current.loading).toBe(false)
  })

  it('still works when no subject is given', async () => {
    answered()
    const { result, rerender } = renderHook(() => useAgentQuery())
    await act(async () => { await result.current.ask('q', 'ctx') })
    rerender()
    expect(result.current.history).toHaveLength(1)
  })

  it('keeps the transcript when an entity joins the collection', async () => {
    answered()
    const { result, rerender } = renderHook(({ s }) => useAgentQuery(s), {
      initialProps: { s: [{ id: 'wiki-USA', label: 'United States' }] },
    })
    await act(async () => { await result.current.ask('q', 'ctx') })

    act(() => { rerender({ s: [
      { id: 'wiki-USA',   label: 'United States' },
      { id: 'wiki-Trump', label: 'Donald Trump' },
    ] }) })

    expect(answers(result.current.history)).toHaveLength(1)
    const note = result.current.history[result.current.history.length - 1]
    expect(note.kind).toBe('subject-added')
    // Named, so the operator can see which answers were written without it.
    expect(note.kind === 'subject-added' && note.labels).toEqual(['Donald Trump'])
  })

  it('discards the transcript when an entity leaves the collection', async () => {
    answered()
    const { result, rerender } = renderHook(({ s }) => useAgentQuery(s), {
      initialProps: { s: [
        { id: 'wiki-USA',   label: 'United States' },
        { id: 'wiki-Trump', label: 'Donald Trump' },
      ] },
    })
    await act(async () => { await result.current.ask('q', 'ctx') })

    act(() => { rerender({ s: [{ id: 'wiki-USA', label: 'United States' }] }) })
    expect(result.current.history).toHaveLength(0)
  })

  it('marks nothing when the collection is only reordered', async () => {
    answered()
    const a = { id: 'wiki-USA',   label: 'United States' }
    const b = { id: 'wiki-Trump', label: 'Donald Trump' }
    const { result, rerender } = renderHook(({ s }) => useAgentQuery(s), {
      initialProps: { s: [a, b] },
    })
    await act(async () => { await result.current.ask('q', 'ctx') })

    act(() => { rerender({ s: [b, a] }) })
    expect(result.current.history).toHaveLength(1)
  })

  it('marks nothing when growth precedes every answer', () => {
    const { result, rerender } = renderHook(({ s }) => useAgentQuery(s), {
      initialProps: { s: [{ id: 'wiki-USA', label: 'United States' }] },
    })
    act(() => { rerender({ s: [
      { id: 'wiki-USA',   label: 'United States' },
      { id: 'wiki-Trump', label: 'Donald Trump' },
    ] }) })
    // A note above an empty transcript would be marking nothing.
    expect(result.current.history).toHaveLength(0)
  })

  it('lets an in-flight answer finish when an entity joins mid-stream', async () => {
    let push!: (chunk: string) => void
    let close!: () => void
    const enc = new TextEncoder()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(ctrl) {
          push  = (c) => ctrl.enqueue(enc.encode(c))
          close = () => ctrl.close()
        },
      }),
    } as unknown as Response)

    const { result, rerender } = renderHook(({ s }) => useAgentQuery(s), {
      initialProps: { s: [{ id: 'wiki-USA', label: 'United States' }] },
    })
    let asking!: Promise<void>
    act(() => { asking = result.current.ask('q', 'ctx') as unknown as Promise<void> })
    await act(async () => { await Promise.resolve() })

    act(() => { rerender({ s: [
      { id: 'wiki-USA',   label: 'United States' },
      { id: 'wiki-Trump', label: 'Donald Trump' },
    ] }) })

    // The question was asked about the old collection and is still a fair
    // question about it, so aborting it would throw away a valid answer.
    await act(async () => { push(sseChunk('answer')); push(sseDone()); close(); await asking })
    expect(answers(result.current.history)).toHaveLength(1)
    expect(answers(result.current.history)[0].streaming).toBe(false)
    expect(answers(result.current.history)[0].html).toContain('answer')
  })

  it('does not leave loading stuck when the subject changes mid-request', async () => {
    // A body that never closes, so the request is still in flight at the switch.
    vi.mocked(fetch).mockResolvedValue({
      ok: true, body: new ReadableStream<Uint8Array>({ start() {} }),
    } as unknown as Response)

    const { result, rerender } = renderHook(({ k }) => useAgentQuery(k), {
      initialProps: { k: 'a' },
    })
    act(() => { void result.current.ask('q', 'ctx') })
    await act(async () => { await Promise.resolve() })

    act(() => { rerender({ k: 'b' }) })
    // Stuck loading would leave the send button disabled on the new subject.
    expect(result.current.loading).toBe(false)
    expect(result.current.history).toHaveLength(0)
  })
})

/**
 * What the reader sees before the answer is finished.
 *
 * The panels used to show the raw stream as text, so an unclosed `<p>` sat on
 * screen as literal markup until the last token arrived and the whole answer was
 * finally parsed. It is sanitised on the way in now, which also closes what the
 * model has not closed yet — an HTML parser does that with any document that
 * ends early.
 */
describe('useAgentQuery — partial answers', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  function openStream() {
    let push!: (chunk: string) => void
    let close!: () => void
    const enc = new TextEncoder()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(ctrl) {
          push  = (c) => ctrl.enqueue(enc.encode(c))
          close = () => ctrl.close()
        },
      }),
    } as unknown as Response)
    return { push: (c: string) => push(c), close: () => close() }
  }

  it('closes a tag the model has not closed yet', async () => {
    const stream = openStream()
    const { result } = renderHook(() => useAgentQuery())
    act(() => { void result.current.ask('q', '') })
    await act(async () => { await Promise.resolve() })

    await act(async () => { stream.push(sseChunk('<p>half a sen')) })
    await waitFor(() => expect(answers(result.current.history)[0]?.html).toBe('<p>half a sen</p>'))
    expect(answers(result.current.history)[0].streaming).toBe(true)

    await act(async () => { stream.push(sseChunk('tence</p>')); stream.push(sseDone()); stream.close() })
    await waitFor(() => expect(answers(result.current.history)[0].streaming).toBe(false))
    expect(answers(result.current.history)[0].html).toBe('<p>half a sentence</p>')
  })

  it('applies the whitelist to a partial answer, not only to the finished one', async () => {
    // What is shown mid-stream is injected as HTML exactly like the finished
    // answer, so it has to pass the same sanitizer.
    const stream = openStream()
    const { result } = renderHook(() => useAgentQuery())
    act(() => { void result.current.ask('q', '') })
    await act(async () => { await Promise.resolve() })

    await act(async () => { stream.push(sseChunk('<p>ok</p><script>alert(1)</scr')) })
    await waitFor(() => expect(answers(result.current.history)[0]?.html).toContain('ok'))
    expect(answers(result.current.history)[0].html).not.toContain('<script')

    await act(async () => { stream.push(sseDone()); stream.close() })
  })
})
