import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PredictionPanel } from '../PredictionPanel'
import { useAppStore } from '../../../store'
import type { PredictionMarket } from '../../../hooks/usePredictionMarkets'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: unknown) => (typeof d === 'string' ? d : k),
    i18n: { language: 'en' },
  }),
}))

const feed = vi.hoisted(() => ({ markets: [] as PredictionMarket[], loading: false }))
vi.mock('../../../hooks/usePredictionMarkets', () => ({
  usePredictionMarkets: () => ({ markets: feed.markets, loading: feed.loading }),
}))

const history = vi.hoisted(() => ({
  series: [] as Array<{ id: string; points: Array<{ t: string; price: number }> }>,
  /** What the panel last asked the history hook to do. */
  enabled: null as boolean | null,
}))
vi.mock('../../../hooks/usePredictionHistories', () => ({
  usePredictionHistories: (_slugs: string[], enabled: boolean) => {
    history.enabled = enabled
    return enabled ? history.series : []
  },
}))

const market = (over: Partial<PredictionMarket> = {}): PredictionMarket => ({
  id:              'ceasefire-2027',
  provider:        'kalshi',
  question:        'Will there be a ceasefire before 2027?',
  price:           0.23,
  change24hPoints: 5,
  volumeUsd:       4_200_000,
  resolvesAt:      '2026-12-31T12:00:00Z',
  asOf:            '2026-08-27T12:00:00Z',
  url:             'https://polymarket.com/event/ceasefire-2027',
  historyKey:      'KXCEASE|KXCEASE-27',
  category:        'ARMED_CONFLICT',
  ...over,
})

beforeEach(() => {
  cleanup()
  feed.markets = []
  feed.loading = false
  history.series = []
  history.enabled = null
  useAppStore.setState({ showPredictionPanel: true, upColor: 'green', sceneTime: null })
})

/** An hour offset from a fixed midnight, as the series and the scrubber see it. */
const T = (h: number) => new Date(Date.parse('2026-08-27T00:00:00Z') + h * 3600_000)

describe('PredictionPanel', () => {
  it('renders nothing at all when it is closed', () => {
    useAppStore.setState({ showPredictionPanel: false })
    feed.markets = [market()]
    const { container } = render(<PredictionPanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the question exactly as the market asks it', () => {
    // The wording is the only place two near-duplicate markets differ, so it
    // is never paraphrased and never cut down to a headline.
    feed.markets = [market()]
    render(<PredictionPanel />)
    expect(screen.getByText(/Will there be a ceasefire before 2027\?/)).toBeTruthy()
  })

  it('states the price as a market price rather than as a probability', () => {
    feed.markets = [market()]
    render(<PredictionPanel />)
    expect(screen.getByText('23%')).toBeTruthy()
    expect(screen.getByText(/Market price of the YES side, not a probability/)).toBeTruthy()
  })

  it('labels the daily move in points', () => {
    feed.markets = [market()]
    render(<PredictionPanel />)
    expect(screen.getByText('+5.0 pts')).toBeTruthy()
  })

  it('qualifies the price with its depth and its horizon', () => {
    feed.markets = [market()]
    render(<PredictionPanel />)
    expect(screen.getByText('$4.2M')).toBeTruthy()
    expect(screen.getByText('12-31')).toBeTruthy()
  })

  it('links out to the market and nowhere else', () => {
    // The link is the whole of the interaction: this app never takes a
    // position, and a reader who wants the resolution criteria has one place
    // to go for them.
    feed.markets = [market()]
    const { container } = render(<PredictionPanel />)
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://polymarket.com/event/ceasefire-2027')
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('groups rows under the same categories the rest of the interface uses', () => {
    feed.markets = [
      market(),
      market({ id: 'fed-cut', question: 'Fed cut in September?', category: 'ECONOMIC' }),
    ]
    render(<PredictionPanel />)
    expect(screen.getByText('CONFLICT')).toBeTruthy()
    expect(screen.getByText('ECONOMIC')).toBeTruthy()
  })

  it('has one way of saying it has nothing to show', () => {
    // An unreachable upstream, a watchlist whose markets have all resolved and
    // a list nobody filled in are the same absence to a reader.
    render(<PredictionPanel />)
    expect(screen.getByText('NO MARKETS AVAILABLE')).toBeTruthy()
  })

  it('says it is still reading before it says there is nothing', () => {
    feed.loading = true
    render(<PredictionPanel />)
    expect(screen.getByText('READING MARKETS…')).toBeTruthy()
  })

  it('keeps the rows up while a refresh is in flight', () => {
    // A refresh that blanked the panel would make a working list flicker once
    // a minute.
    feed.markets = [market()]
    feed.loading = true
    render(<PredictionPanel />)
    expect(screen.getByText('23%')).toBeTruthy()
    expect(screen.queryByText('READING MARKETS…')).toBeNull()
  })
})

describe('PredictionPanel, rewound', () => {
  const scrubTo = (h: number) => useAppStore.setState({ sceneTime: T(h).getTime() })

  const series = (id: string, pts: Array<[number, number]>) => ({
    id,
    points: pts.map(([h, price]) => ({ t: T(h).toISOString(), price })),
  })

  it('shows the price as it stood at the scrubbed instant', () => {
    feed.markets = [market({ price: 0.31 })]
    history.series = [series('ceasefire-2027', [[0, 0.20], [6, 0.25], [12, 0.31]])]
    scrubTo(7)
    render(<PredictionPanel />)
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.queryByText('31%')).toBeNull()
  })

  it('recomputes the daily move for that instant rather than carrying the live one', () => {
    // The live figure is +5.0 pts. At the scrubbed instant the market had moved
    // twelve points over the preceding day, and showing +5.0 beside a rewound
    // price would be two numbers that cannot both be true.
    feed.markets = [market({ change24hPoints: 5 })]
    history.series = [series('ceasefire-2027', [[0, 0.20], [24, 0.32]])]
    scrubTo(24)
    render(<PredictionPanel />)
    expect(screen.getByText('+12.0 pts')).toBeTruthy()
    expect(screen.queryByText('+5.0 pts')).toBeNull()
  })

  it('stamps the instant its numbers belong to', () => {
    feed.markets = [market()]
    history.series = [series('ceasefire-2027', [[0, 0.20], [6, 0.25]])]
    scrubTo(7)
    render(<PredictionPanel />)
    expect(screen.getByText(/AS OF 07:00 UTC/)).toBeTruthy()
  })

  it('carries no timestamp while live, where every number is current', () => {
    feed.markets = [market()]
    render(<PredictionPanel />)
    expect(screen.queryByText(/AS OF/)).toBeNull()
  })

  it('drops a market that had no price yet at that instant', () => {
    // At 3am a market that opened at 6am genuinely had no price, and there is
    // no row to hang an empty cell on.
    feed.markets = [market()]
    history.series = [series('ceasefire-2027', [[6, 0.25], [12, 0.31]])]
    scrubTo(3)
    render(<PredictionPanel />)
    expect(screen.getByText('NO MARKETS AVAILABLE')).toBeTruthy()
  })

  it('leaves the move blank when the series cannot reach a day back', () => {
    feed.markets = [market()]
    history.series = [series('ceasefire-2027', [[5, 0.20], [6, 0.25]])]
    scrubTo(7)
    render(<PredictionPanel />)
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('leaves history unfetched for a reader who never scrubs', () => {
    // These payloads are orders of magnitude larger than the prices, and live
    // the panel already has every number it needs from the markets endpoint.
    feed.markets = [market()]
    render(<PredictionPanel />)
    expect(history.enabled).toBe(false)
    expect(screen.getByText('23%')).toBeTruthy()
  })

  it('fetches history once the reader scrubs', () => {
    feed.markets = [market()]
    history.series = [series('ceasefire-2027', [[0, 0.20], [6, 0.25]])]
    scrubTo(7)
    render(<PredictionPanel />)
    expect(history.enabled).toBe(true)
  })
})
