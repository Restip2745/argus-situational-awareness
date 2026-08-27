/**
 * The shape a prediction market takes once it is past the provider boundary.
 *
 * Two sources sit behind this, and the reason is not generality for its own
 * sake: reachability differs by region. Polymarket is DNS-blocked in Taiwan and
 * elsewhere, Kalshi is not; a self-hosted dashboard whose readers are scattered
 * cannot pick one and be done. Having two implementations is also the only
 * thing that makes this interface trustworthy — an abstraction fitted to a
 * single source is just that source with extra steps.
 *
 * What the two do NOT share is left out on purpose. Polymarket is keyed on a
 * slug and Kalshi on a ticker, so the field here is `id` rather than either
 * lie. Polymarket reports dollars matched and Kalshi reports contracts that
 * settle at a dollar each, so `volumeUsd` is documented as face value rather
 * than pretending the two are the same measure.
 */

export interface PredictionMarket {
  /** Provider-scoped identity: a slug on Polymarket, a ticker on Kalshi. */
  id:              string
  /** Which source this row came from. Carried so the panel can say. */
  provider:        ProviderName
  /** The question as the source asks it, never paraphrased. Where a source
   *  splits it across a title and a horizon, the two are joined and nothing
   *  else is added. */
  question:        string
  /** YES price as a fraction, 0–1, in the source's own unit. */
  price:           number
  /** Daily move in percentage points, or null when it cannot be established.
   *  Not every source reports one, and a source that reports "the previous
   *  price" without saying over what period cannot be used for this. */
  change24hPoints: number | null
  /**
   * Size, in USD.
   *
   * Face value traded, not dollars matched — the two sources measure this
   * differently and neither number is wrong, but they are not interchangeable.
   * Polymarket reports dollars actually matched. Kalshi reports contracts,
   * each of which settles at one dollar, so its figure is the total that would
   * change hands if every contract paid out. Kalshi's is therefore the larger
   * of the two for the same real activity, and a volume floor has to be set
   * per provider rather than once.
   */
  volumeUsd:       number
  /** Resolution date, ISO 8601, or null for a market with no fixed end. */
  resolvesAt:      string | null
  /** When the price was read. These trade continuously, so this really is now. */
  asOf:            string
  /** The market's page at the source, for the reader to check its rules. */
  url:             string
  /**
   * Whatever the provider needs to fetch this market's history, or null when
   * it cannot be charted.
   *
   * Opaque here by design. Polymarket keys price history on a CLOB token id
   * belonging to a different service; Kalshi keys it on the series the market
   * sits under. Neither belongs in this file, and a caller that has to know
   * which is which has lost the point of the boundary.
   */
  historyKey:      string | null
}

/** One point of a market's price series. */
export interface PricePoint {
  /** ISO 8601. */
  t:     string
  /** YES price as a fraction, 0–1, on the same scale as `PredictionMarket`. */
  price: number
}

export interface PriceSeries {
  id:     string
  points: PricePoint[]
}

/**
 * Windows a caller may ask for.
 *
 * `1d` is what the timeline needs. `1w` is what it actually asks for, since the
 * daily move at the far end of a 24-hour scrub is measured from two days back.
 */
export const VALID_WINDOWS = ['1d', '1w', '1m'] as const
export type PriceWindow = typeof VALID_WINDOWS[number]

export function isValidWindow(w: string): w is PriceWindow {
  return (VALID_WINDOWS as readonly string[]).includes(w)
}

/** How far back each window reaches, in milliseconds. */
export const WINDOW_MS: Record<PriceWindow, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
}

export type ProviderName = 'kalshi' | 'polymarket'

export const PROVIDER_NAMES: ProviderName[] = ['kalshi', 'polymarket']

export function isProviderName(v: unknown): v is ProviderName {
  return typeof v === 'string' && (PROVIDER_NAMES as string[]).includes(v)
}

/**
 * What a source has to do to be one of these.
 *
 * Deliberately two methods. Everything else a source might offer — search,
 * order books, categories of its own — is either not used by this panel or is
 * a thing the watchlist already decides by hand, and putting it here would be
 * building for a caller that does not exist.
 */
export interface PredictionProvider {
  readonly name: ProviderName

  /**
   * Whether an id is one this provider will forward.
   *
   * Ids come from a file in the repo rather than from a user, so this is not
   * guarding against an adversary — but each is interpolated into an outbound
   * URL and into an anchor href, and a whitelist is cheaper than reasoning
   * about either. The two sources have different shapes, which is reason
   * enough for this to live behind the boundary.
   */
  isValidId(id: string): boolean

  /** One market, or null if it is not a row a panel can honestly draw. */
  fetchMarket(id: string): Promise<PredictionMarket | null>

  /**
   * One market's price series, or null.
   *
   * Takes the market rather than the id because the routing key is opaque
   * above this line — see `historyKey`.
   */
  fetchSeries(market: PredictionMarket, window: PriceWindow): Promise<PriceSeries | null>
}
