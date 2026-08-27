import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store'
import { usePanelDrag } from '../../hooks/usePanelDrag'
import { usePredictionMarkets, type PredictionMarket } from '../../hooks/usePredictionMarkets'
import { categoryTint, categoryLabel } from '../../data/symbology'
import { Panel } from './Panel'
import {
  formatMarketPrice, formatPoints, pointsColor, formatResolves, formatVolume,
} from '../../utils/prediction'
import type { UpColor } from '../../utils/quote'

const ACCENT = '#ffb347'

/** Matches the server's cache window; asking more often only costs a trip. */
const REFRESH_MS = 60 * 1000

/**
 * What is priced to happen — the watchlist panel.
 *
 * Every other market surface in this app looks backwards: a close, and how far
 * it moved from the one before it. That is the wrong question for most of what
 * this dashboard tracks, and for elections, ceasefires and rate decisions there
 * is no instrument to ask it of anyway. These rows are the other direction.
 *
 * Two rules run through the layout:
 *
 * **The question is rendered verbatim and given the width.** Two markets can
 * ask what sounds like the same thing and resolve on different criteria, and
 * the wording is the only place that difference exists. It is never truncated
 * to a headline, never paraphrased, and it wraps rather than ellipsing.
 *
 * **The column is labelled MARKET PRICE, not probability.** Fees, the cost of
 * capital and longshot bias all sit between the two, and the panel states the
 * fact it has — what the last trade paid — rather than the inference a reader
 * may want to draw from it. Same discipline as the event panel putting two
 * prices side by side without claiming one caused the other.
 *
 * Grouped by the same nine categories as everything else, so a reader moving
 * from the filter bar to here does not have to learn a second vocabulary.
 */
export function PredictionPanel() {
  const { t } = useTranslation()
  const show    = useAppStore((s) => s.showPredictionPanel)
  const setShow = useAppStore((s) => s.setShowPredictionPanel)
  const upColor = useAppStore((s) => s.upColor)

  const { panelRef, pos, dragging, onHeaderMouseDown, zIndex, handleBringToFront, uiScale } =
    usePanelDrag({ panelKey: 'prediction', defaultPos: { x: 360, y: 100 } })

  const { markets, loading } = usePredictionMarkets(undefined, show ? REFRESH_MS : undefined)

  if (!show) return null

  // Grouped in the order the rows arrive, which is the order the watchlist file
  // declares them. That list is maintained by hand and reads top to bottom;
  // re-sorting it here would hide the shape its maintainer gave it.
  const groups: Array<[string, PredictionMarket[]]> = []
  for (const m of markets) {
    const key = m.category ?? 'OTHER'
    const last = groups[groups.length - 1]
    if (last && last[0] === key) last[1].push(m)
    else groups.push([key, [m]])
  }

  return (
    <Panel
      panelRef={panelRef}
      accentColor={ACCENT}
      width={340}
      onMouseDown={handleBringToFront}
      dragging={dragging}
      onHeaderMouseDown={onHeaderMouseDown}
      title={<span style={{ color: ACCENT }}>◈ {t('prediction.title', 'PREDICTION MARKETS')}</span>}
      onClose={() => setShow(false)}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex,
        maxHeight: `calc(${100 / uiScale}vh - 140px)`,
      }}
    >
      {markets.length === 0 ? (
        <div style={{ padding: '14px 12px', fontSize: '10px', color: '#3d5568', lineHeight: 1.8 }}>
          {loading
            ? t('prediction.loading', 'READING MARKETS…')
            // The one message the panel has. An upstream that cannot be
            // reached, a watchlist whose markets have all resolved, and a list
            // nobody has filled in are the same absence to a reader, and three
            // ways of saying it would imply a distinction the panel cannot
            // actually make.
            : t('prediction.empty', 'NO MARKETS AVAILABLE')}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '6px 10px 10px' }}>
          {groups.map(([cat, rows]) => (
            <div key={cat} style={{ marginTop: '8px' }}>
              <div style={{
                color: categoryTint(cat), fontSize: '10px', letterSpacing: '0.15em',
                marginBottom: '3px', opacity: 0.8,
              }}>
                {categoryLabel(cat)}
              </div>
              {rows.map((m) => (
                <MarketRow key={m.slug} market={m} upColor={upColor} />
              ))}
            </div>
          ))}

          {/* Says what the numbers are and what they are not. Once at the
              bottom rather than per row: a caveat repeated nine times stops
              being read after the second. */}
          <div style={{
            marginTop: '12px', paddingTop: '8px', fontSize: '10px', lineHeight: 1.7,
            color: '#3d5568', borderTop: '1px solid rgba(0,180,255,0.08)',
          }}>
            {t('prediction.footnote',
               'Market price of the YES side, not a probability. Not an investment tool.')}
          </div>
        </div>
      )}
    </Panel>
  )
}

interface RowProps {
  market:  PredictionMarket
  upColor: UpColor
}

/**
 * One market.
 *
 * The question sits on its own line above the numbers rather than beside them.
 * Tried as a single row, the question is what gets clipped — exactly backwards,
 * since it is the part that says what the number means. Same lesson the quote
 * rows record about their date column: when something has to give, it must not
 * be the thing that makes the number legible.
 *
 * The whole question is the link out. A reader who wants to know how a market
 * resolves has one place to go and does not have to find a separate affordance
 * to get there — and going there is the only interaction offered. Nothing in
 * this app takes a position.
 */
export function MarketRow({ market, upColor }: RowProps) {
  const { t } = useTranslation()

  return (
    <div style={{ padding: '5px 0', borderBottom: '1px solid rgba(0,180,255,0.05)' }}>
      <a
        href={market.url}
        target="_blank"
        rel="noopener noreferrer"
        title={t('prediction.openMarket', 'Open this market at the source')}
        style={{
          display: 'block', fontSize: '10px', lineHeight: 1.5, color: '#c8dde8',
          textDecoration: 'none', marginBottom: '3px',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = ACCENT }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#c8dde8' }}
      >
        {market.question}
        <span style={{ color: '#3d5568', marginLeft: '4px' }}>↗</span>
      </a>

      <div style={{
        display: 'flex', alignItems: 'baseline', gap: '8px',
        fontSize: '10px', whiteSpace: 'nowrap',
      }}>
        <span style={{
          color: '#e8dcc8', fontVariantNumeric: 'tabular-nums',
          width: '38px', textAlign: 'right',
        }}>
          {formatMarketPrice(market.price)}
        </span>

        <span style={{
          color: pointsColor(market.change24hPoints, upColor),
          fontVariantNumeric: 'tabular-nums', width: '62px', textAlign: 'right',
        }}>
          {formatPoints(market.change24hPoints)}
        </span>

        <span style={{ flex: 1 }} />

        {/* Volume and resolution date are the two things that qualify the
            number: how much stands behind it, and what horizon it is about. */}
        <span
          title={t('prediction.volume', 'Traded volume')}
          style={{ color: '#5d7c92', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatVolume(market.volumeUsd)}
        </span>

        <span
          title={market.resolvesAt
            ? new Date(market.resolvesAt).toLocaleString()
            : t('prediction.noResolveDate', 'No fixed resolution date')}
          style={{
            color: '#3d5568', fontVariantNumeric: 'tabular-nums',
            width: '58px', textAlign: 'right',
          }}
        >
          {formatResolves(market.resolvesAt)}
        </span>
      </div>
    </div>
  )
}
