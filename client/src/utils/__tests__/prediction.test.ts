import { describe, it, expect } from 'vitest'
import {
  formatMarketPrice, formatPoints, pointsColor, formatResolves, formatVolume,
  priceAt, changePointsAt,
} from '../prediction'

const NOW = Date.parse('2026-08-27T12:00:00Z')

describe('formatMarketPrice', () => {
  it('renders the price as a whole percentage', () => {
    expect(formatMarketPrice(0.23)).toBe('23%')
    expect(formatMarketPrice(0.5)).toBe('50%')
  })

  it('does not invent precision the market does not quote', () => {
    // The upstream trades in cents. A row reading 23.4% would claim a
    // resolution the price does not have, and would look more authoritative
    // for it.
    expect(formatMarketPrice(0.234)).toBe('23%')
    expect(formatMarketPrice(0.236)).toBe('24%')
  })

  it('survives a number that is not one', () => {
    expect(formatMarketPrice(NaN)).toBe('—')
  })
})

describe('formatPoints', () => {
  it('names the unit, because the number is meaningless without it', () => {
    // 23% to 28% is five points. Read as a percent change — which is what
    // every other market row in this app shows — it is +21.7%, wrong by a
    // factor of four and impossible to tell apart from correct.
    expect(formatPoints(5)).toBe('+5.0 pts')
    expect(formatPoints(-2.4)).toBe('-2.4 pts')
  })

  it('always carries the sign of a rise', () => {
    expect(formatPoints(0.5)).toBe('+0.5 pts')
  })

  it('prints an unmoved market as zero rather than as a tiny move', () => {
    expect(formatPoints(0.01)).toBe('0.0 pts')
    expect(formatPoints(-0.01)).toBe('0.0 pts')
  })

  it('distinguishes a market that did not move from one it was not told about', () => {
    // Rendering null as "0.0 pts" would assert a fact the upstream never gave.
    expect(formatPoints(null)).toBe('—')
    expect(formatPoints(0)).toBe('0.0 pts')
  })
})

describe('pointsColor', () => {
  it('follows the reader\'s rise and fall convention', () => {
    expect(pointsColor(5, 'green')).toBe(pointsColor(5, 'green'))
    expect(pointsColor(5, 'green')).not.toBe(pointsColor(5, 'red'))
    expect(pointsColor(5, 'green')).toBe(pointsColor(-5, 'red'))
  })

  it('colours an unmoved market neither way', () => {
    const flat = pointsColor(0, 'green')
    expect(pointsColor(0, 'red')).toBe(flat)
    // Absent is treated as unmoved for colour, since there is no direction to
    // claim; the text still says "—".
    expect(pointsColor(null, 'green')).toBe(flat)
  })
})

describe('formatResolves', () => {
  it('shows the resolution date in the same shape as a quote as-of date', () => {
    // Both columns answer "what date is this number attached to". Two formats
    // for one question would read as two different kinds of fact.
    expect(formatResolves('2026-12-31T12:00:00Z', NOW)).toBe('12-31')
  })

  it('carries the year whenever it is not the current one', () => {
    // Common here, unlike on a quote: most of these resolve next year.
    expect(formatResolves('2027-03-15T00:00:00Z', NOW)).toBe('2027-03-15')
  })

  it('says nothing rather than something for a market with no fixed end', () => {
    expect(formatResolves(null, NOW)).toBe('—')
  })

  it('survives a date it cannot read', () => {
    expect(formatResolves('not a date', NOW)).toBe('—')
  })
})

describe('formatVolume', () => {
  it('shortens the number to something that fits a column', () => {
    expect(formatVolume(4_200_000)).toBe('$4.2M')
    expect(formatVolume(250_000)).toBe('$250K')
    expect(formatVolume(1_500)).toBe('$2K')
    expect(formatVolume(400)).toBe('$400')
  })

  it('survives a number that is not one', () => {
    expect(formatVolume(NaN)).toBe('—')
    expect(formatVolume(-1)).toBe('—')
  })
})

// ── Rewinding ────────────────────────────────────────────────────────────────

describe('priceAt', () => {
  const T = (h: number) => new Date(Date.parse('2026-08-27T00:00:00Z') + h * 3600_000).toISOString()
  const at = (h: number) => Date.parse(T(h))
  const points = [
    { t: T(0), price: 0.20 },
    { t: T(6), price: 0.25 },
    { t: T(12), price: 0.31 },
  ]

  it('takes the last price at or before the instant', () => {
    expect(priceAt(points, at(6))).toBe(0.25)
    expect(priceAt(points, at(9))).toBe(0.25)
    expect(priceAt(points, at(12))).toBe(0.31)
  })

  it('never reaches forward to a price that had not happened yet', () => {
    // At 05:00 the market was still at 0.20. Showing 0.25 because it is the
    // nearest print would put a future price on a past instant.
    expect(priceAt(points, at(5))).toBe(0.20)
  })

  it('says nothing for an instant before the market had a price', () => {
    // Not a gap to paper over: a market that opened this morning genuinely had
    // no price at 3am.
    expect(priceAt(points, at(-1))).toBeNull()
    expect(priceAt([], at(6))).toBeNull()
  })

  it('does not depend on the upstream sending points in order', () => {
    const shuffled = [points[2], points[0], points[1]]
    expect(priceAt(shuffled, at(9))).toBe(0.25)
  })
})

describe('changePointsAt', () => {
  const T = (h: number) => new Date(Date.parse('2026-08-27T00:00:00Z') + h * 3600_000).toISOString()
  const at = (h: number) => Date.parse(T(h))

  it('measures the day ending at the instant, not the day ending now', () => {
    // The whole point of rewinding: a price from six hours ago beside a change
    // measured to right now is two numbers that cannot both be true.
    const points = [
      { t: T(0),  price: 0.20 },
      { t: T(24), price: 0.25 },
      { t: T(48), price: 0.40 },
    ]
    expect(changePointsAt(points, at(24))).toBeCloseTo(5, 6)
    expect(changePointsAt(points, at(48))).toBeCloseTo(15, 6)
  })

  it('carries the sign of a fall', () => {
    const points = [{ t: T(0), price: 0.30 }, { t: T(24), price: 0.22 }]
    expect(changePointsAt(points, at(24))).toBeCloseTo(-8, 6)
  })

  it('says nothing when the series does not reach a full day back', () => {
    // A shorter window would answer a different question than the column asks,
    // and would do it silently.
    const points = [{ t: T(20), price: 0.30 }, { t: T(24), price: 0.22 }]
    expect(changePointsAt(points, at(24))).toBeNull()
  })
})
