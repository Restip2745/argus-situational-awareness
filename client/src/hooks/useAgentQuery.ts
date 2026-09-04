import { useState, useCallback, useRef, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// Whitelist-based HTML sanitizer — strips all attributes and non-whitelisted tags
const ALLOWED = new Set(['p','ul','ol','li','table','thead','tbody','tr','td','th','b','i','h4','br','span'])

function sanitizeHtml(raw: string): string {
  const div = document.createElement('div')
  div.innerHTML = raw
  sanitizeNode(div)
  return div.innerHTML
}

function sanitizeNode(el: Element) {
  for (const child of [...el.children]) {
    const tag = child.tagName.toLowerCase()
    for (const attr of [...child.attributes]) child.removeAttribute(attr.name)
    if (!ALLOWED.has(tag)) {
      const parent = child.parentNode!
      while (child.firstChild) parent.insertBefore(child.firstChild, child)
      parent.removeChild(child)
    } else {
      sanitizeNode(child)
    }
  }
}

/** One thing the conversation is about. */
export interface AgentSubject {
  /** Stable identity — the same value whichever path collected it. */
  id: string
  /** What to call it in the transcript if it joins mid-conversation. */
  label: string
}

export interface AgentAnswer {
  kind:      'answer'
  id:        string
  question:  string
  html:      string   // sanitized HTML, partial while the answer is still arriving
  streaming: boolean  // true while tokens are arriving
}

/**
 * The mark left where the subject grew. It is not an answer and asks nothing —
 * it exists so the transcript above it cannot be read as having been written
 * with the entities below it in view.
 */
export interface AgentSubjectAdded {
  kind:   'subject-added'
  id:     string
  labels: string[]
}

export type AgentEntry = AgentAnswer | AgentSubjectAdded

const MAX_CONTEXT_CHARS = 8000

/**
 * How often a partial answer is re-rendered.
 *
 * Each repaint sanitises the whole answer so far, so painting per token is
 * quadratic in the length of the answer. At this interval a long answer costs a
 * few hundred passes over a few kilobytes, and the text still arrives faster
 * than it can be read.
 */
const PAINT_INTERVAL_MS = 33

/** True while a request is in flight and its answer has yet to say anything. */
export function awaitingFirstToken(history: AgentEntry[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]
    if (entry.kind === 'answer') return entry.html === ''
  }
  return false
}

function toSubjects(subject?: string | readonly AgentSubject[]): AgentSubject[] {
  if (subject === undefined) return []
  if (typeof subject === 'string') return subject === '' ? [] : [{ id: subject, label: subject }]
  return [...subject]
}

/**
 * @param subject What the conversation is about — an event id, a country name,
 *   the set of collected entities. When it changes, the transcript is usually
 *   discarded.
 *
 *   The reason is not leakage: each request carries only a system prompt and
 *   one user message, so the model never sees earlier turns and answers every
 *   question in isolation already. The reason is that a transcript *looks*
 *   like a conversation. Left standing across a switch it reads as though the
 *   second answer built on the first, when the second question was in fact
 *   asked with only the new subject's context — the UI would be claiming a
 *   continuity that does not exist, and claiming it most loudly at the moment
 *   the answers visibly concern different things.
 *
 *   Growth is the case that argument does not cover. When every earlier subject
 *   is still present and one has joined them, no answer above has been
 *   contradicted: each was true of what it was asked about, and that thing is
 *   still on the table. Wiping there punishes the ordinary way a comparison is
 *   built — one entity, a question, another entity — and punishes it hardest
 *   for the operator who is using the panel as intended. So the transcript
 *   stands, and a `subject-added` entry records where the ground moved, which
 *   keeps the honest half of the old rule: the answers above it are still
 *   visibly answers about less.
 */
export function useAgentQuery(subject?: string | readonly AgentSubject[]) {
  const [history, setHistory] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const subjects   = toSubjects(subject)
  // NUL-joined: ids carry spaces and punctuation, and any separator one of
  // them could itself contain would make ['a|b'] and ['a', 'b'] one subject.
  const subjectKey = subjects.map(s => s.id).join('\u0000')

  // Read inside the effect, which runs on the key alone — the array is rebuilt
  // on every render and would retrigger it forever as a dependency.
  const subjectsRef = useRef(subjects)
  subjectsRef.current = subjects

  const prevKeyRef = useRef(subjectKey)
  const prevIdsRef = useRef(new Set(subjects.map(s => s.id)))

  useEffect(() => {
    if (prevKeyRef.current === subjectKey) return
    const prevIds = prevIdsRef.current
    const next    = subjectsRef.current
    prevKeyRef.current = subjectKey
    prevIdsRef.current = new Set(next.map(s => s.id))

    // Nothing the earlier answers were about has left.
    if ([...prevIds].every(id => prevIdsRef.current.has(id))) {
      const added = next.filter(s => !prevIds.has(s.id))
      // A pure reorder adds nothing and needs no mark. Neither does growth
      // that no answer precedes.
      if (added.length === 0) return
      setHistory(h => h.length === 0 ? h : [...h, {
        kind:   'subject-added',
        id:     `subject-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        labels: added.map(s => s.label),
      }])
      return
    }

    // Abort first: a stream still arriving for the previous subject would
    // otherwise finish writing its answer into the new subject's transcript.
    abortRef.current?.abort()
    abortRef.current = null
    setHistory([])
    setError(null)
    setLoading(false)
  }, [subjectKey])

  const ask = useCallback(async (question: string, context: string) => {
    if (!question.trim() || loading) return

    // Cancel any in-flight stream
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setError(null)

    // Guard context size — truncate and note for the user
    const contextTruncated = context.length > MAX_CONTEXT_CHARS
    const effectiveContext = contextTruncated ? context.slice(0, MAX_CONTEXT_CHARS) : context

    // Add a streaming placeholder entry; use a stable ID to avoid index collisions
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setHistory(h => [...h, { kind: 'answer', id: entryId, question: question.trim(), html: '', streaming: true }])

    try {
      const res = await fetch(`${API_BASE}/api/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), context: effectiveContext }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''
      let   rawText = ''
      let   doneReceived = false
      let   lastPaint = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''   // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') { doneReceived = true; continue }
          try {
            const parsed = JSON.parse(payload) as { text?: string; error?: string }
            if (parsed.error) throw new Error(parsed.error)
            if (parsed.text) {
              rawText += parsed.text
              // Sanitised on the way in, not only at the end: what is shown
              // mid-stream is injected as HTML exactly like the finished answer,
              // so it has to pass the same whitelist. Throttled because each pass
              // reparses the whole answer so far.
              const now = Date.now()
              if (now - lastPaint >= PAINT_INTERVAL_MS) {
                lastPaint = now
                const partial = sanitizeHtml(rawText)
                setHistory(h => h.map((e) =>
                  e.id === entryId ? { ...e, html: partial } : e
                ))
              }
            }
          } catch { /* malformed chunk — skip */ }
        }
      }

      // Stream done: sanitize full HTML and mark complete
      const truncationNotice = contextTruncated
        ? '<div class="context-truncated-notice">⚠ Context truncated to 8 000 chars</div>'
        : ''
      const interruptedNotice = !doneReceived && rawText.length > 0
        ? '<div class="stream-interrupted-notice">⚠ Response interrupted</div>'
        : ''
      const safe = truncationNotice + sanitizeHtml(rawText) + interruptedNotice
      setHistory(h => h.map((e) =>
        e.id === entryId ? { ...e, html: safe, streaming: false } : e
      ))
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
      // Remove the empty placeholder on error
      setHistory(h => h.filter((e) => e.id !== entryId))
    } finally {
      setLoading(false)
    }
  }, [loading])

  const clear = useCallback(() => { setHistory([]); setError(null) }, [])

  return { history, loading, error, ask, clear }
}
