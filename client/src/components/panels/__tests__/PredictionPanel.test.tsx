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

const market = (over: Partial<PredictionMarket> = {}): PredictionMarket => ({
  slug:            'ceasefire-2027',
  question:        'Will there be a ceasefire before 2027?',
  price:           0.23,
  change24hPoints: 5,
  volumeUsd:       4_200_000,
  resolvesAt:      '2026-12-31T12:00:00Z',
  asOf:            '2026-08-27T12:00:00Z',
  url:             'https://polymarket.com/event/ceasefire-2027',
  yesTokenId:      'tok-yes',
  category:        'ARMED_CONFLICT',
  ...over,
})

beforeEach(() => {
  cleanup()
  feed.markets = []
  feed.loading = false
  useAppStore.setState({ showPredictionPanel: true, upColor: 'green' })
})

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
      market({ slug: 'fed-cut', question: 'Fed cut in September?', category: 'ECONOMIC' }),
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
