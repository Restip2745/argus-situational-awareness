import { describe, it, expect } from 'vitest'
import { parseMarket, parsePriceHistory, polymarket, MIN_VOLUME_USD } from '../services/prediction/polymarket'

/**
 * A fixed "now".
 *
 * Passed explicitly because `parseMarket` rejects markets whose end date has
 * passed: left to the real clock, every fixture below would start failing on
 * the day its resolution date went by.
 */
const NOW = Date.parse('2026-08-27T00:00:00Z')

/**
 * A live binary market, in the shape the source is assumed to send it.
 *
 * Assumed, not observed — the domain could not be reached from the machine this
 * was written on. Numbers and arrays are JSON-encoded as strings because that
 * is the shape the parser has to survive if the assumption holds.
 */
const CEASEFIRE = {
  question:          'Will there be a ceasefire before 2027?',
  outcomes:          '["Yes", "No"]',
  outcomePrices:     '["0.23", "0.77"]',
  clobTokenIds:      '["tok-yes", "tok-no"]',
  oneDayPriceChange: 0.05,
  volumeNum:         4_200_000,
  endDate:           '2026-12-31T12:00:00Z',
  closed:            false,
  active:            true,
  events:            [{ slug: 'ceasefire-2027' }],
}

const withField = (patch: Record<string, unknown>) => [{ ...CEASEFIRE, ...patch }]

describe('parseMarket', () => {
  it('reads the question, the YES price and what stands behind it', () => {
    const m = parseMarket([CEASEFIRE], 'ceasefire-slug', NOW)
    expect(m).not.toBeNull()
    expect(m!.id).toBe('ceasefire-slug')
    expect(m!.provider).toBe('polymarket')
    expect(m!.question).toBe('Will there be a ceasefire before 2027?')
    expect(m!.price).toBe(0.23)
    expect(m!.volumeUsd).toBe(4_200_000)
    expect(m!.resolvesAt).toBe('2026-12-31T12:00:00.000Z')
  })

  it('reports the daily move in percentage points, not percent', () => {
    // 23% to 28% is +5 points. Read as a percent change it is +21.7%, wrong by
    // a factor of four and rendering just as plausibly. This source states the
    // period, unlike the other one, so it can be taken at its word.
    expect(parseMarket([CEASEFIRE], 's', NOW)!.change24hPoints).toBe(5)
  })

  it('leaves the move absent rather than zero when the source is silent', () => {
    expect(parseMarket(withField({ oneDayPriceChange: undefined }), 's', NOW)!.change24hPoints)
      .toBeNull()
  })

  it('times the price at the read, because these trade continuously', () => {
    expect(parseMarket([CEASEFIRE], 's', NOW)!.asOf).toBe(new Date(NOW).toISOString())
  })

  it('takes a single record as readily as the list a slug query returns', () => {
    expect(parseMarket(CEASEFIRE, 's', NOW)).not.toBeNull()
    expect(parseMarket([CEASEFIRE], 's', NOW)).not.toBeNull()
  })

  it('reads native arrays too, in case the encoding is not what it seems', () => {
    const m = parseMarket(
      withField({ outcomes: ['Yes', 'No'], outcomePrices: [0.4, 0.6] }), 's', NOW)
    expect(m!.price).toBe(0.4)
  })

  it('finds YES by its label rather than by its position', () => {
    // Position is a convention, and one that silently inverts a probability is
    // not worth relying on: reading index 0 here would report 77% for a market
    // priced at 23%.
    const m = parseMarket(withField({
      outcomes:      '["No", "Yes"]',
      outcomePrices: '["0.77", "0.23"]',
      clobTokenIds:  '["tok-no", "tok-yes"]',
    }), 's', NOW)
    expect(m!.price).toBe(0.23)
    expect(m!.historyKey).toBe('tok-yes')
  })

  it('refuses a market that has already settled', () => {
    expect(parseMarket(withField({ closed: true }), 's', NOW)).toBeNull()
    expect(parseMarket(withField({ archived: true }), 's', NOW)).toBeNull()
    expect(parseMarket(withField({ active: false }), 's', NOW)).toBeNull()
  })

  it('refuses a market whose resolution date has passed', () => {
    expect(parseMarket(withField({ endDate: '2020-01-01T00:00:00Z' }), 's', NOW)).toBeNull()
  })

  it('keeps a market with no fixed end date', () => {
    const m = parseMarket(withField({ endDate: undefined }), 's', NOW)
    expect(m).not.toBeNull()
    expect(m!.resolvesAt).toBeNull()
  })

  it('refuses a market with more than two outcomes', () => {
    // A five-way election cannot be told in one row. Showing the leading
    // outcome discards the rest: the reader sees "34%" with no sign that the
    // other 66% is split rather than opposed.
    expect(parseMarket(withField({
      outcomes:      '["Alice", "Bob", "Carol"]',
      outcomePrices: '["0.2", "0.3", "0.5"]',
    }), 's', NOW)).toBeNull()
  })

  it('refuses a binary market that has no side named YES', () => {
    expect(parseMarket(withField({
      outcomes:      '["Alice", "Bob"]',
      outcomePrices: '["0.4", "0.6"]',
    }), 's', NOW)).toBeNull()
  })

  it('refuses a price of exactly zero or one, which is settlement not opinion', () => {
    expect(parseMarket(withField({ outcomePrices: '["1", "0"]' }), 's', NOW)).toBeNull()
    expect(parseMarket(withField({ outcomePrices: '["0", "1"]' }), 's', NOW)).toBeNull()
  })

  it('refuses a market too thin for its price to mean anything', () => {
    expect(parseMarket(withField({ volumeNum: MIN_VOLUME_USD - 1 }), 's', NOW)).toBeNull()
    expect(parseMarket(withField({ volumeNum: MIN_VOLUME_USD }), 's', NOW)).not.toBeNull()
  })

  it('refuses a market whose volume it cannot read at all', () => {
    expect(parseMarket(withField({ volumeNum: undefined, volume: undefined }), 's', NOW))
      .toBeNull()
  })

  it('falls back to the other volume field when the first is absent', () => {
    const m = parseMarket(withField({ volumeNum: undefined, volume: '250000' }), 's', NOW)
    expect(m!.volumeUsd).toBe(250_000)
  })

  it('links to the parent event page, where the criteria are legible', () => {
    expect(parseMarket([CEASEFIRE], 'ceasefire-slug', NOW)!.url)
      .toBe('https://polymarket.com/event/ceasefire-2027')
  })

  it('falls back to the market page when the payload carries no event', () => {
    expect(parseMarket(withField({ events: undefined }), 'my-slug', NOW)!.url)
      .toBe('https://polymarket.com/market/my-slug')
  })

  it('refuses an event slug from the payload that could steer the href', () => {
    // This one came from the source rather than from the repo's watchlist, so
    // it is re-validated even though the requested id already was.
    expect(parseMarket(withField({ events: [{ slug: '../../evil' }] }), 'my-slug', NOW)!.url)
      .toBe('https://polymarket.com/market/my-slug')
  })

  it('prices a market it cannot chart rather than dropping it', () => {
    const m = parseMarket(withField({ clobTokenIds: undefined }), 's', NOW)
    expect(m).not.toBeNull()
    expect(m!.historyKey).toBeNull()
  })

  it('survives every shape that is not the one documented', () => {
    expect(parseMarket(null, 's', NOW)).toBeNull()
    expect(parseMarket({}, 's', NOW)).toBeNull()
    expect(parseMarket([], 's', NOW)).toBeNull()
    expect(parseMarket({ error: 'not found' }, 's', NOW)).toBeNull()
    expect(parseMarket('<html>rate limited</html>', 's', NOW)).toBeNull()
    expect(parseMarket(withField({ outcomePrices: 'not json' }), 's', NOW)).toBeNull()
    expect(parseMarket(withField({ outcomePrices: '["high", "low"]' }), 's', NOW)).toBeNull()
  })
})

describe('polymarket.isValidId', () => {
  it('accepts the slug form this source uses', () => {
    expect(polymarket.isValidId('will-there-be-a-ceasefire-before-2027')).toBe(true)
    expect(polymarket.isValidId('2026-midterms')).toBe(true)
  })

  it('rejects anything that could steer the outbound URL or the href', () => {
    expect(polymarket.isValidId('../../markets')).toBe(false)
    expect(polymarket.isValidId('slug?foo=1')).toBe(false)
    expect(polymarket.isValidId('two words')).toBe(false)
    expect(polymarket.isValidId('Upper-Case')).toBe(false)
    expect(polymarket.isValidId('-leading-dash')).toBe(false)
    expect(polymarket.isValidId('')).toBe(false)
  })
})

describe('parsePriceHistory', () => {
  const T0 = 1786339802

  it('pairs each price with its own timestamp', () => {
    const out = parsePriceHistory(
      { history: [{ t: T0, p: 0.31 }, { t: T0 + 3600, p: 0.34 }] }, 'ceasefire-slug')
    expect(out).not.toBeNull()
    expect(out!.id).toBe('ceasefire-slug')
    expect(out!.points).toEqual([
      { t: new Date(T0 * 1000).toISOString(),          price: 0.31 },
      { t: new Date((T0 + 3600) * 1000).toISOString(), price: 0.34 },
    ])
  })

  it('reads prices that arrive as strings', () => {
    expect(parsePriceHistory({ history: [{ t: T0, p: '0.31' }] }, 's')!.points[0].price).toBe(0.31)
  })

  it('drops points outside the range rather than clamping them', () => {
    // A clamped point is a price nobody ever paid.
    const out = parsePriceHistory(
      { history: [{ t: T0, p: 0.31 }, { t: T0 + 3600, p: 1 }, { t: T0 + 7200, p: 0 }] }, 's')
    expect(out!.points.map((p) => p.price)).toEqual([0.31])
  })

  it('returns nothing rather than an empty line', () => {
    expect(parsePriceHistory({ history: [] }, 's')).toBeNull()
    expect(parsePriceHistory({ history: [{ t: null, p: null }] }, 's')).toBeNull()
  })

  it('survives every shape that is not the one documented', () => {
    expect(parsePriceHistory(null, 's')).toBeNull()
    expect(parsePriceHistory({}, 's')).toBeNull()
    expect(parsePriceHistory({ history: 'nope' }, 's')).toBeNull()
  })
})
