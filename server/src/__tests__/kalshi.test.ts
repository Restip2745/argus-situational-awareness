import { describe, it, expect } from 'vitest'
import { parseEvent, parseCandles, dailyMovePoints, kalshi, MIN_VOLUME } from '../services/prediction/kalshi'

/**
 * A fixed "now".
 *
 * Passed explicitly because `parseEvent` rejects markets past their close time:
 * left to the real clock these fixtures would start failing on the day their
 * resolution date went by.
 */
const NOW = Date.parse('2026-08-27T00:00:00Z')

/**
 * A live yes/no event, in the shape the exchange really sends it.
 *
 * Numbers arrive as strings here on purpose — that is what comes back, and a
 * fixture written in native types would test a payload nobody receives.
 */
const IMPEACH = {
  event_ticker:       'KXIMPEACH-29',
  series_ticker:      'KXIMPEACH',
  title:              'Will President Trump be impeached during his term?',
  sub_title:          'Before Jan 20, 2029',
  category:           'Politics',
  mutually_exclusive: false,
  markets: [{
    ticker:             'KXIMPEACH-29',
    status:             'active',
    market_type:        'binary',
    last_price_dollars: '0.6300',
    volume_fp:          '518065',
    open_interest_fp:   '160138',
    close_time:         '2029-01-20T17:00:00Z',
    expiration_time:    '2029-01-20T17:00:00Z',
  }],
}

const withEvent = (patch: Record<string, unknown>) => ({ ...IMPEACH, ...patch })
const withMarket = (patch: Record<string, unknown>) =>
  ({ ...IMPEACH, markets: [{ ...IMPEACH.markets[0], ...patch }] })

describe('parseEvent', () => {
  it('reads the question, the price and what stands behind it', () => {
    const m = parseEvent(IMPEACH, 'KXIMPEACH-29', NOW)
    expect(m).not.toBeNull()
    expect(m!.id).toBe('KXIMPEACH-29')
    expect(m!.provider).toBe('kalshi')
    expect(m!.price).toBe(0.63)
    expect(m!.volumeUsd).toBe(518065)
    expect(m!.resolvesAt).toBe('2029-01-20T17:00:00.000Z')
  })

  it('joins the horizon onto the question, since without it it is a different question', () => {
    // Both halves are the exchange's own words; nothing is rewritten.
    expect(parseEvent(IMPEACH, 'x', NOW)!.question)
      .toBe('Will President Trump be impeached during his term? — Before Jan 20, 2029')
  })

  it('keeps the question whole when there is no separate horizon', () => {
    expect(parseEvent(withEvent({ sub_title: undefined }), 'x', NOW)!.question)
      .toBe('Will President Trump be impeached during his term?')
  })

  it('takes the wrapped shape the single-event endpoint returns', () => {
    expect(parseEvent({ event: IMPEACH }, 'x', NOW)).not.toBeNull()
    expect(parseEvent(IMPEACH, 'x', NOW)).not.toBeNull()
  })

  it('carries both halves of the history key, which neither caller should parse', () => {
    expect(parseEvent(IMPEACH, 'x', NOW)!.historyKey).toBe('KXIMPEACH|KXIMPEACH-29')
  })

  it('reports no daily move of its own', () => {
    // Nothing in this payload states a period for one. The provider fills it in
    // from the series, which does.
    expect(parseEvent(IMPEACH, 'x', NOW)!.change24hPoints).toBeNull()
  })

  it('refuses an event whose markets are rival outcomes', () => {
    // "Who will be the next Secretary General of NATO" arrives as eight binary
    // markets. Each passes a per-market check, and a row reading "Kaja Kallas
    // 9%" says nothing about whether the other 91% is one opponent or seven.
    expect(parseEvent(withEvent({ mutually_exclusive: true }), 'x', NOW)).toBeNull()
  })

  it('refuses an event carrying more than one market even when not marked exclusive', () => {
    // Different strikes on the same underlying. The watchlist names an event
    // and has no way to say which of them it meant.
    const twoStrikes = withEvent({ markets: [IMPEACH.markets[0], IMPEACH.markets[0]] })
    expect(parseEvent(twoStrikes, 'x', NOW)).toBeNull()
  })

  it('refuses an event carrying no markets at all', () => {
    expect(parseEvent(withEvent({ markets: [] }), 'x', NOW)).toBeNull()
    expect(parseEvent(withEvent({ markets: undefined }), 'x', NOW)).toBeNull()
  })

  it('refuses a market that is not trading', () => {
    // A settled market renders exactly like live conviction — worse than a
    // stale quote, being a certainty displayed as a forecast.
    expect(parseEvent(withMarket({ status: 'settled' }), 'x', NOW)).toBeNull()
    expect(parseEvent(withMarket({ status: 'closed' }), 'x', NOW)).toBeNull()
  })

  it('refuses a market that is not binary', () => {
    expect(parseEvent(withMarket({ market_type: 'scalar' }), 'x', NOW)).toBeNull()
  })

  it('refuses a listing nobody has ever traded', () => {
    // The exchange lists a great many of these, priced at exactly zero.
    expect(parseEvent(withMarket({ last_price_dollars: '0.0000' }), 'x', NOW)).toBeNull()
    expect(parseEvent(withMarket({ last_price_dollars: '1.0000' }), 'x', NOW)).toBeNull()
  })

  it('refuses a market too thin for its price to mean anything', () => {
    expect(parseEvent(withMarket({ volume_fp: String(MIN_VOLUME - 1) }), 'x', NOW)).toBeNull()
    expect(parseEvent(withMarket({ volume_fp: String(MIN_VOLUME) }), 'x', NOW)).not.toBeNull()
  })

  it('refuses a market whose close time has passed', () => {
    expect(parseEvent(withMarket({
      close_time: '2020-01-01T00:00:00Z', expiration_time: '2020-01-01T00:00:00Z',
    }), 'x', NOW)).toBeNull()
  })

  it('falls back to the expiration time when there is no close time', () => {
    const m = parseEvent(withMarket({ close_time: undefined }), 'x', NOW)
    expect(m!.resolvesAt).toBe('2029-01-20T17:00:00.000Z')
  })

  it('survives every shape that is not the one documented', () => {
    expect(parseEvent(null, 'x', NOW)).toBeNull()
    expect(parseEvent({}, 'x', NOW)).toBeNull()
    expect(parseEvent({ error: 'not found' }, 'x', NOW)).toBeNull()
    expect(parseEvent('<html>rate limited</html>', 'x', NOW)).toBeNull()
    expect(parseEvent(withMarket({ last_price_dollars: 'n/a' }), 'x', NOW)).toBeNull()
  })
})

describe('kalshi.isValidId', () => {
  it('accepts the ticker forms the exchange issues', () => {
    expect(kalshi.isValidId('KXIMPEACH-29')).toBe(true)
    expect(kalshi.isValidId('CHINAUSGDP')).toBe(true)
    expect(kalshi.isValidId('NYTOAI-27DEC31')).toBe(true)
  })

  it('rejects anything that could steer the outbound URL or the href', () => {
    expect(kalshi.isValidId('../../markets')).toBe(false)
    expect(kalshi.isValidId('KX?foo=1')).toBe(false)
    expect(kalshi.isValidId('two words')).toBe(false)
    expect(kalshi.isValidId('lower-case')).toBe(false)
    expect(kalshi.isValidId('-LEADING')).toBe(false)
    expect(kalshi.isValidId('')).toBe(false)
  })
})

// ── History ──────────────────────────────────────────────────────────────────

describe('parseCandles', () => {
  const TS = 1787799600

  it('takes the close where a period traded', () => {
    const body = { candlesticks: [{
      end_period_ts: TS,
      price: { close_dollars: '0.1300', high_dollars: '0.1300', previous_dollars: '0.1200' },
    }] }
    expect(parseCandles(body, 'x')!.points).toEqual([
      { t: new Date(TS * 1000).toISOString(), price: 0.13 },
    ])
  })

  it('carries the price forward through a period that did not trade', () => {
    // A quiet candle has only `previous_dollars`. Skipping it would leave gaps
    // wherever a slow market sat still, which is most of the series.
    const body = { candlesticks: [{ end_period_ts: TS, price: { previous_dollars: '0.1200' } }] }
    expect(parseCandles(body, 'x')!.points[0].price).toBe(0.12)
  })

  it('drops points outside the range rather than clamping them', () => {
    const body = { candlesticks: [
      { end_period_ts: TS,        price: { previous_dollars: '0.1200' } },
      { end_period_ts: TS + 3600, price: { close_dollars: '1.0000' } },
      { end_period_ts: TS + 7200, price: { close_dollars: '0.0000' } },
    ] }
    expect(parseCandles(body, 'x')!.points.map((p) => p.price)).toEqual([0.12])
  })

  it('returns nothing rather than an empty line', () => {
    expect(parseCandles({ candlesticks: [] }, 'x')).toBeNull()
    expect(parseCandles({ candlesticks: [{ end_period_ts: TS, price: {} }] }, 'x')).toBeNull()
  })

  it('survives every shape that is not the one documented', () => {
    expect(parseCandles(null, 'x')).toBeNull()
    expect(parseCandles({}, 'x')).toBeNull()
    expect(parseCandles({ candlesticks: 'nope' }, 'x')).toBeNull()
  })
})

describe('dailyMovePoints', () => {
  const T = (h: number) => new Date(NOW + h * 3600_000).toISOString()
  const at = (h: number) => NOW + h * 3600_000

  it('measures the day ending at the instant, in percentage points', () => {
    const series = { id: 'x', points: [
      { t: T(0), price: 0.20 }, { t: T(12), price: 0.24 }, { t: T(24), price: 0.32 },
    ] }
    expect(dailyMovePoints(series, at(24))).toBeCloseTo(12, 6)
  })

  it('carries the sign of a fall', () => {
    const series = { id: 'x', points: [{ t: T(0), price: 0.30 }, { t: T(24), price: 0.22 }] }
    expect(dailyMovePoints(series, at(24))).toBeCloseTo(-8, 6)
  })

  it('says nothing when the series does not reach a full day back', () => {
    // The field the exchange offers instead — `previous_price_dollars` — does
    // not state a period, so a column labelled as a daily move cannot use it.
    // An incomplete series is the same problem and gets the same answer.
    const series = { id: 'x', points: [{ t: T(20), price: 0.30 }, { t: T(24), price: 0.22 }] }
    expect(dailyMovePoints(series, at(24))).toBeNull()
  })
})
