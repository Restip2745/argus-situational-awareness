import { useState, useEffect, useRef } from 'react'
import type { EventCategory } from '../types'

/** Mirrors the server's `PredictionMarket`, plus the watchlist's category. */
export interface PredictionMarket {
  slug:            string
  question:        string
  /** YES price as a fraction, 0–1. */
  price:           number
  /** Daily move in percentage points, or null when the upstream said nothing. */
  change24hPoints: number | null
  volumeUsd:       number
  /** ISO 8601, or null for a market with no fixed end. */
  resolvesAt:      string | null
  asOf:            string
  /** The market's page upstream. */
  url:             string
  yesTokenId:      string | null
  /** Null for a market asked for by slug rather than taken from the watchlist. */
  category:        EventCategory | null
}

interface State {
  markets: PredictionMarket[]
  loading: boolean
}

/**
 * The watchlist, or the markets for `slugs` when given some.
 *
 * No client-side cache, unlike `useQuotes`. That one exists because the same
 * company shows up in several panels at once and a close does not change while
 * you read it; neither is true here. This panel is the only reader, and its
 * numbers move continuously — a cache would exist purely to serve a staler copy
 * of the one thing the reader opened the panel to see.
 *
 * `refreshMs` re-reads on an interval, for as long as the panel is open. The
 * server holds each price for a minute, so asking more often than that only
 * costs a round trip.
 *
 * An empty result is the normal failure: a watchlist gone stale, or an upstream
 * that cannot be reached, both arrive as no rows. The caller renders nothing.
 */
export function usePredictionMarkets(slugs?: string[], refreshMs?: number): State {
  const [state, setState] = useState<State>({ markets: [], loading: true })
  const [tick, setTick] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  // Effects cannot depend on an array identity that changes every render.
  const key = slugs?.join(',') ?? ''

  useEffect(() => {
    if (!refreshMs) return
    const id = setInterval(() => setTick((t) => t + 1), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Keeps the rows on screen while the next read is in flight. A refresh that
    // blanked the panel for a round trip would make a working list flicker
    // once a minute.
    setState((s) => ({ markets: s.markets, loading: true }))

    const url = key
      ? `/api/prediction/markets?slugs=${encodeURIComponent(key)}`
      : '/api/prediction/markets'

    fetch(url, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() as Promise<PredictionMarket[]> : []))
      .then((markets) => {
        if (ctrl.signal.aborted) return
        setState({ markets, loading: false })
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        // No error state. An unreachable upstream and a watchlist whose markets
        // have all resolved are the same absence to a reader, and the panel has
        // one way of saying it.
        setState({ markets: [], loading: false })
      })

    return () => ctrl.abort()
  }, [key, tick])

  return state
}
