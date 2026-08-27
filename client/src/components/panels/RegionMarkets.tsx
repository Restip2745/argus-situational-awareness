import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store'
import { usePredictionMarkets } from '../../hooks/usePredictionMarkets'
import { formatMarketPrice, formatPoints, pointsColor, formatResolves } from '../../utils/prediction'

interface Props {
  country: string
}

/**
 * What is priced to happen to this country.
 *
 * Sits beside the stock index for the same reason that does: it is a reading of
 * a place, not of something the reader clicked. The index answers what this
 * country's market has done; these answer what is expected of the country
 * itself — a normalisation of relations, a trade agreement, a recession.
 *
 * Matched from the watchlist rather than from the source. The plan had been to
 * use the exchange's own tags, and there are none to use: four of Kalshi's 220
 * are countries, incidentally rather than as a taxonomy. Matching country names
 * against the question text was the alternative and brings back the failure the
 * whole feature is shaped around, so the countries are written down beside each
 * market in `predictionMarkets.ts` and travel with the row.
 *
 * That bounds this to the watchlist, which is the same scope everything else in
 * the feature has. Most countries have no row here and render nothing at all.
 *
 * No volume column, unlike the prediction panel. There is room for four numbers
 * in a region panel and the fifth to drop is the one that qualifies the price
 * rather than states it — the panel is answering "what is the state of this
 * place", and a reader who wants to weigh the number has the link.
 */
export function RegionMarkets({ country }: Props) {
  const { t } = useTranslation()
  const upColor = useAppStore((s) => s.upColor)

  // The same request the prediction panel makes, and the same cached answer;
  // the filtering is the only thing that differs.
  const { markets } = usePredictionMarkets()
  const rows = markets.filter((m) => m.countries.includes(country))

  if (rows.length === 0) return null

  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{
        color: '#2a4060', fontSize: '10px', letterSpacing: '0.15em', marginBottom: '4px',
      }}>
        {t('region.predictionMarkets', 'PREDICTION MARKETS')}
      </div>

      <div style={{
        border: '1px solid rgba(255,179,71,0.10)',
        borderRadius: '2px',
        background: 'rgba(255,179,71,0.03)',
        padding: '4px 6px',
      }}>
        {rows.map((m) => (
          <div key={m.id} style={{ padding: '3px 0' }}>
            {/* The question in full, as everywhere else: two markets can ask
                what sounds like the same thing and resolve differently, and
                the wording is the only place that shows. */}
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', fontSize: '10px', lineHeight: 1.5,
                color: '#7a9ab0', textDecoration: 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#ffb347' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#7a9ab0' }}
            >
              {m.question}
              <span style={{ color: '#3d5568', marginLeft: '4px' }}>↗</span>
            </a>

            <div style={{
              display: 'flex', alignItems: 'baseline', gap: '6px',
              fontSize: '10px', lineHeight: 1.9, whiteSpace: 'nowrap',
            }}>
              <span style={{
                color: '#e8dcc8', width: '38px', textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatMarketPrice(m.price)}
              </span>

              <span style={{
                color: pointsColor(m.change24hPoints, upColor),
                width: '62px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              }}>
                {formatPoints(m.change24hPoints)}
              </span>

              <span style={{ flex: 1 }} />

              {/* Every market row in this app carries the date its number is
                  attached to. Here that is the resolution date: a price with
                  no horizon is not a claim about anything. */}
              <span
                title={m.resolvesAt ? new Date(m.resolvesAt).toLocaleString() : undefined}
                style={{ color: '#3d5568', fontVariantNumeric: 'tabular-nums' }}
              >
                {formatResolves(m.resolvesAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
