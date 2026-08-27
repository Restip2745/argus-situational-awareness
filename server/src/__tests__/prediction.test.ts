import { describe, it, expect } from 'vitest'
import {
  parseMarket,
  parsePriceHistory,
  isValidSlug,
  isValidWindow,
  MIN_VOLUME_USD,
} from '../services/prediction'

/**
 * A fixed "now".
 *
 * Passed explicitly everywhere because `parseMarket` rejects markets whose end
 * date has passed: left to the real clock, every fixture below would start
 * failing on the day its resolution date went by.
 */
const NOW = Date.parse('2026-08-27T00:00:00Z')

/**
 * A live binary market, in the shape the upstream is assumed to send it.
 *
 * Numbers and arrays arrive JSON-encoded as strings here on purpose — that is
 * the shape the parser has to survive, and writing the fixture in native types
 * would test a payload nobody receives.
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

/** The same market with one field replaced, for the single-refusal cases. */
const withField = (patch: Record<string, unknown>) => [{ ...CEASEFIRE, ...patch }]

describe('parseMarket', () => {
  it('reads the question, the YES price and what stands behind it', () => {
    const m = parseMarket([CEASEFIRE], 'ceasefire-slug', NOW)
    expect(m).not.toBeNull()
    expect(m!.slug).toBe('ceasefire-slug')
    expect(m!.question).toBe('Will there be a ceasefire before 2027?')
    expect(m!.price).toBe(0.23)
    expect(m!.volumeUsd).toBe(4_200_000)
    expect(m!.resolvesAt).toBe('2026-12-31T12:00:00.000Z')
  })

  it('reports the daily move in percentage points, not percent', () => {
    // 23% to 28% is +5 points. Read as a percent change it is +21.7%, which is
    // wrong by a factor of four and renders exactly as plausibly.
    expect(parseMarket([CEASEFIRE], 's', NOW)!.change24hPoints).toBe(5)
  })

  it('leaves the move absent rather than zero when the upstream is silent', () => {
    // "Did not move" and "was not told" are different facts, and the view can
    // only tell them apart if the parse layer does.
    expect(parseMarket(withField({ oneDayPriceChange: undefined }), 's', NOW)!.change24hPoints)
      .toBeNull()
  })

  it('times the price at the read, because these trade continuously', () => {
    // The opposite of a quote, which must carry the time of its close: there is
    // no session here, so the fetch time really is when the price was true.
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
    // Position is a convention, and a convention that silently inverts a
    // probability is not one worth relying on: reading index 0 here would
    // report 77% for a market priced at 23%.
    const m = parseMarket(withField({
      outcomes:      '["No", "Yes"]',
      outcomePrices: '["0.77", "0.23"]',
      clobTokenIds:  '["tok-no", "tok-yes"]',
    }), 's', NOW)
    expect(m!.price).toBe(0.23)
    expect(m!.yesTokenId).toBe('tok-yes')
  })

  it('refuses a market that has already settled', () => {
    // A resolved market sits at 0.99 and renders exactly like live conviction.
    // Worse than a stale quote: not merely old, but a certainty displayed as a
    // forecast.
    expect(parseMarket(withField({ closed: true }), 's', NOW)).toBeNull()
    expect(parseMarket(withField({ archived: true }), 's', NOW)).toBeNull()
    expect(parseMarket(withField({ active: false }), 's', NOW)).toBeNull()
  })

  it('refuses a market whose resolution date has passed', () => {
    // The flags above and this date disagree often enough — a market can stop
    // trading before anything marks it closed — that both are checked.
    expect(parseMarket(withField({ endDate: '2020-01-01T00:00:00Z' }), 's', NOW)).toBeNull()
  })

  it('keeps a market with no fixed end date', () => {
    // Open-ended markets exist and are legitimate; the row simply shows no
    // resolution date rather than being dropped.
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
    // The dormant-GDR failure again: $400 of volume prices identically to $4m,
    // and the thin one is frequently the more dramatic number because almost
    // nothing has to move to make it.
    expect(parseMarket(withField({ volumeNum: MIN_VOLUME_USD - 1 }), 's', NOW)).toBeNull()
    expect(parseMarket(withField({ volumeNum: MIN_VOLUME_USD }), 's', NOW)).not.toBeNull()
  })

  it('refuses a market whose volume it cannot read at all', () => {
    // Unknown depth is not shallow depth, but it cannot be shown as a number
    // either, and the floor is the whole reason the row is trustworthy.
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
    // This slug came from the upstream rather than from the repo's watchlist,
    // so it is re-validated even though the requested one already was.
    expect(parseMarket(withField({ events: [{ slug: '../../evil' }] }), 'my-slug', NOW)!.url)
      .toBe('https://polymarket.com/market/my-slug')
  })

  it('prices a market it cannot chart rather than dropping it', () => {
    // No token id means no price history. That costs a line on the timeline,
    // not the row.
    const m = parseMarket(withField({ clobTokenIds: undefined }), 's', NOW)
    expect(m).not.toBeNull()
    expect(m!.yesTokenId).toBeNull()
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

describe('isValidSlug', () => {
  it('accepts the form the upstream uses', () => {
    expect(isValidSlug('will-there-be-a-ceasefire-before-2027')).toBe(true)
    expect(isValidSlug('fed-decision-2026-09')).toBe(true)
    expect(isValidSlug('2026-midterms')).toBe(true)
  })

  it('rejects anything that could steer the outbound URL or the href', () => {
    expect(isValidSlug('../../markets')).toBe(false)
    expect(isValidSlug('slug?foo=1')).toBe(false)
    expect(isValidSlug('two words')).toBe(false)
    expect(isValidSlug('Upper-Case')).toBe(false)
    expect(isValidSlug('-leading-dash')).toBe(false)
    expect(isValidSlug('')).toBe(false)
  })
})

describe('isValidWindow', () => {
  it('accepts the windows the panel asks for and nothing else', () => {
    expect(isValidWindow('1d')).toBe(true)
    expect(isValidWindow('max')).toBe(true)
    expect(isValidWindow('1y')).toBe(false)
    expect(isValidWindow('')).toBe(false)
  })
})

// ── History ──────────────────────────────────────────────────────────────────

describe('parsePriceHistory', () => {
  const T0 = 1786339802

  it('pairs each price with its own timestamp', () => {
    const out = parsePriceHistory(
      { history: [{ t: T0, p: 0.31 }, { t: T0 + 3600, p: 0.34 }] }, 'ceasefire-slug')
    expect(out).not.toBeNull()
    expect(out!.slug).toBe('ceasefire-slug')
    expect(out!.points).toEqual([
      { t: new Date(T0 * 1000).toISOString(),          price: 0.31 },
      { t: new Date((T0 + 3600) * 1000).toISOString(), price: 0.34 },
    ])
  })

  it('reads prices that arrive as strings', () => {
    const out = parsePriceHistory({ history: [{ t: T0, p: '0.31' }] }, 's')
    expect(out!.points[0].price).toBe(0.31)
  })

  it('drops points outside the range rather than clamping them', () => {
    // A clamped point is a price nobody ever paid — the same reasoning that
    // drops shut days from a close series instead of interpolating them.
    const out = parsePriceHistory(
      { history: [{ t: T0, p: 0.31 }, { t: T0 + 3600, p: 1 }, { t: T0 + 7200, p: 0 }] }, 's')
    expect(out!.points.map((p) => p.price)).toEqual([0.31])
  })

  it('drops points it cannot read without losing the ones it can', () => {
    const out = parsePriceHistory(
      { history: [{ t: T0, p: 0.31 }, { t: null, p: 0.4 }, { t: T0 + 7200, p: 'n/a' }] }, 's')
    expect(out!.points).toHaveLength(1)
  })

  it('returns nothing rather than an empty line', () => {
    // A series with no readable points is an absence, not a flat chart at zero.
    expect(parsePriceHistory({ history: [] }, 's')).toBeNull()
    expect(parsePriceHistory({ history: [{ t: null, p: null }] }, 's')).toBeNull()
  })

  it('survives every shape that is not the one documented', () => {
    expect(parsePriceHistory(null, 's')).toBeNull()
    expect(parsePriceHistory({}, 's')).toBeNull()
    expect(parsePriceHistory({ history: 'nope' }, 's')).toBeNull()
    expect(parsePriceHistory('<html>rate limited</html>', 's')).toBeNull()
  })
})
