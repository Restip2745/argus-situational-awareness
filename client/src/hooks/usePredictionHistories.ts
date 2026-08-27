import { useState, useEffect, useRef } from 'react'
import type { PricePoint } from '../utils/prediction'

export interface PriceSeries {
  slug:   string
  points: PricePoint[]
}

/**
 * How far back the series is asked for.
 *
 * A week, though the scrub only reaches back a day. The daily-move column is
 * measured over the 24 hours *ending at* whatever instant the reader has
 * scrubbed to, so answering it at the far end of the timeline needs prices from
 * two days ago. A `1d` window would leave that column blank exactly when the
 * reader has scrubbed furthest — which is to say, exactly when they are looking
 * hardest.
 */
const WINDOW = '1w'

/**
 * Price series for `slugs`, fetched only while `enabled`.
 *
 * `enabled` is the whole design. Live, the panel already has every number it
 * needs from the markets endpoint, and these payloads are orders of magnitude
 * larger — a reader who never touches the timeline should never pay for them.
 * The first scrub fetches once; the server holds the result for five minutes
 * and this holds it for as long as the panel stays open, so dragging the
 * scrubber back and forth costs nothing after that.
 *
 * Series the upstream cannot supply are absent rather than reported, as
 * everywhere else here: a market with no price history and one whose history
 * could not be reached are the same absence to a row that cannot rewind.
 */
export function usePredictionHistories(slugs: string[], enabled: boolean): PriceSeries[] {
  const [series, setSeries] = useState<PriceSeries[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // Effects cannot depend on an array identity that changes every render.
  const key = slugs.join(',')

  useEffect(() => {
    if (!enabled || !key) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    fetch(
      `/api/prediction/history?slugs=${encodeURIComponent(key)}&window=${WINDOW}`,
      { signal: ctrl.signal },
    )
      .then((res) => (res.ok ? res.json() as Promise<PriceSeries[]> : []))
      .then((fetched) => {
        if (ctrl.signal.aborted) return
        setSeries(fetched)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        // No error state. A panel that cannot rewind shows no rewound prices,
        // which is what an empty result already produces.
        setSeries([])
      })

    return () => ctrl.abort()
    // Deliberately not re-fetching when `enabled` goes false: the series stay
    // in state so returning to live and scrubbing again is free.
  }, [key, enabled])

  return series
}
