import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RegionMarkets } from '../RegionMarkets'
import { useAppStore } from '../../../store'
import type { PredictionMarket } from '../../../hooks/usePredictionMarkets'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: unknown) => (typeof d === 'string' ? d : k),
    i18n: { language: 'en' },
  }),
}))

const feed = vi.hoisted(() => ({ markets: [] as PredictionMarket[] }))
vi.mock('../../../hooks/usePredictionMarkets', () => ({
  usePredictionMarkets: () => ({ markets: feed.markets, loading: false }),
}))

const market = (over: Partial<PredictionMarket> = {}): PredictionMarket => ({
  id:              'KXABRAHAMSA-29',
  provider:        'kalshi',
  question:        'Will Israel and Saudi Arabia normalize relations? — Before Jan 20, 2029',
  price:           0.31,
  change24hPoints: 3,
  volumeUsd:       71_356,
  resolvesAt:      '2029-01-20T17:00:00Z',
  asOf:            '2026-08-27T12:00:00Z',
  url:             'https://kalshi.com/markets/KXABRAHAMSA-29',
  historyKey:      'KXABRAHAMSA|KXABRAHAMSA-29',
  category:        'ARMED_CONFLICT',
  countries:       ['Israel', 'Saudi Arabia'],
  ...over,
})

beforeEach(() => {
  cleanup()
  feed.markets = []
  useAppStore.setState({ upColor: 'green' })
})

describe('RegionMarkets', () => {
  it('shows a market filed under this country', () => {
    feed.markets = [market()]
    render(<RegionMarkets country="Israel" />)
    expect(screen.getByText(/Will Israel and Saudi Arabia normalize relations/)).toBeTruthy()
    expect(screen.getByText('31%')).toBeTruthy()
    expect(screen.getByText('+3.0 pts')).toBeTruthy()
  })

  it('shows the same market on every country it is filed under', () => {
    // A normalisation of relations is a reading of both parties, not of one.
    feed.markets = [market()]
    render(<RegionMarkets country="Saudi Arabia" />)
    expect(screen.getByText(/normalize relations/)).toBeTruthy()
  })

  it('renders nothing for a country with no market', () => {
    // Which is most of them: the watchlist bounds this, as it bounds the rest
    // of the feature.
    feed.markets = [market()]
    const { container } = render(<RegionMarkets country="Japan" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when a market is filed under no country', () => {
    // A Mars landing is a reading of no country, and must not fall through to
    // the launching one.
    feed.markets = [market({ countries: [] })]
    const { container } = render(<RegionMarkets country="United States of America" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('matches the country exactly rather than by substring', () => {
    // "China" must not pull in a market filed under no country whose question
    // merely mentions it — the filing is the claim, not the wording.
    feed.markets = [market({ question: 'Will the U.S. enact a free trade agreement with China?', countries: ['United States of America'] })]
    const { container } = render(<RegionMarkets country="China" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('carries the resolution year, as every market row here carries its date', () => {
    // The year rather than the exact day: `formatAsOf` renders in local time,
    // so a 17:00Z resolution falls on the next date east of UTC+7 and pinning
    // the day would make this pass or fail on where the suite is run. What the
    // row must convey is that this does not resolve in the current year.
    feed.markets = [market()]
    render(<RegionMarkets country="Israel" />)
    expect(screen.getByText(/^2029-/)).toBeTruthy()
  })

  it('links out to the market and nowhere else', () => {
    feed.markets = [market()]
    const { container } = render(<RegionMarkets country="Israel" />)
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://kalshi.com/markets/KXABRAHAMSA-29')
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('leaves the move blank rather than zero when it is not known', () => {
    feed.markets = [market({ change24hPoints: null })]
    render(<RegionMarkets country="Israel" />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})
