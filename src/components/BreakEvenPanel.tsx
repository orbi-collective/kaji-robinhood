import { DECAY_REGIMES, type BreakEven, type Opportunity } from '../lib/types'
import { formatDays } from '../lib/breakeven'
import './BreakEvenPanel.css'

/**
 * What a distribution position costs, and how long it must sit before the
 * income has paid that cost back.
 *
 * The panel exists because neither venue in this meta answers the question. It
 * shows the cost ladder first, because the cost is the part that is certain,
 * then the horizon under three volume regimes, because the income is the part
 * that is not. A single break-even number would be the more confident-looking
 * answer and the less honest one.
 */

const usd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`

export default function BreakEvenPanel({
  opportunity,
  breakEven,
  cycleBasis,
}: {
  opportunity: Opportunity
  breakEven: BreakEven
  cycleBasis: string | null
}) {
  const d = opportunity.distribution
  if (!d) return null

  const resolved = breakEven.blocked_by === null
  const holderPays = d.pays_holders

  return (
    <section className="breakEven" aria-labelledby="be-title">
      <header className="breakEven__head">
        <div>
          <span className="mono-label">BREAK-EVEN</span>
          <h2 id="be-title" className="breakEven__title">
            What it costs, and how long it takes to earn back
          </h2>
        </div>
        <span className={`breakEven__cost ${breakEven.round_trip_bps > 0 ? 'breakEven__cost--charged' : ''}`}>
          {(breakEven.round_trip_bps / 100).toFixed(2)}%
          <span className="breakEven__costLabel mono-label">ROUND TRIP</span>
        </span>
      </header>

      {/* The cost ladder: certain, itemised, each term naming its source. */}
      <div className="breakEven__ladder">
        <div className="costRow costRow--head">
          <span className="mono-label">COST</span>
          <span className="mono-label">OF POSITION</span>
          <span className="mono-label">ON {usd(breakEven.capital_usd)}</span>
          <span className="mono-label">SOURCE</span>
        </div>
        {breakEven.costs.map((c) => (
          <div key={c.label} className="costRow">
            <span className="costRow__label">{c.label}</span>
            <span className="costRow__bps">{(c.bps / 100).toFixed(2)}%</span>
            <span className="costRow__usd">−{usd(c.usd)}</span>
            <span className="costRow__src">{c.source}</span>
          </div>
        ))}
        <div className="costRow costRow--total">
          <span className="costRow__label">Round trip</span>
          <span className="costRow__bps">{(breakEven.round_trip_bps / 100).toFixed(2)}%</span>
          <span className="costRow__usd">−{usd(breakEven.round_trip_cost_usd)}</span>
          <span className="costRow__src">Must be earned back before this position returns anything</span>
        </div>
      </div>

      {/* What the position actually receives. Measured, price-free. */}
      <div className="breakEven__income">
        <div className="incomeCell">
          <span className="mono-label">EARNED PER TOKEN, PER CYCLE</span>
          <span className="incomeCell__value">
            {d.payout_per_token !== null
              ? `${d.payout_per_token.toExponential(2)} ${d.payout_asset ?? ''}`
              : '—'}
          </span>
          <span className="incomeCell__note">
            {!holderPays
              ? 'Holding this token pays nothing'
              : d.pro_rata_verified === true
                ? `Pro-rata confirmed across ${d.samples_taken} sampled recipients`
                : d.pro_rata_verified === false
                  ? `${d.samples_taken} sampled recipients disagreed, so treat this as approximate`
                  : d.samples_taken > 0
                    ? `Measured from ${d.samples_taken} live payout${d.samples_taken > 1 ? 's' : ''}`
                    : 'Not yet measured'}
          </span>
        </div>
        <div className="incomeCell">
          <span className="mono-label">CYCLES PER DAY</span>
          <span className="incomeCell__value">
            {breakEven.cycles_per_day !== null ? breakEven.cycles_per_day.toFixed(0) : '—'}
          </span>
          <span className="incomeCell__note">
            {d.interval_seconds ? `Every ${Math.round(d.interval_seconds / 60)} minutes, from the contract` : 'Cadence not reported'}
          </span>
        </div>
        <div className="incomeCell">
          <span className="mono-label">INCOME PER DAY</span>
          <span className={`incomeCell__value ${breakEven.daily_income_usd ? 'incomeCell__value--lime' : ''}`}>
            {breakEven.daily_income_usd !== null ? usd(breakEven.daily_income_usd) : '—'}
          </span>
          <span className="incomeCell__note">
            {cycleBasis ?? 'Cycle value not priced'}
          </span>
        </div>
      </div>

      {/* The horizon, under three regimes. Never one number. */}
      {resolved ? (
        <>
          <div className="regimes" role="table" aria-label="Break-even under three volume regimes">
            <div className="regimes__row regimes__row--head" role="row">
              <span role="columnheader" className="mono-label">
                IF VOLUME…
              </span>
              <span role="columnheader" className="mono-label">
                BREAK-EVEN
              </span>
              <span role="columnheader" className="mono-label">
                WHY THIS REGIME
              </span>
            </div>
            {DECAY_REGIMES.map((r) => {
              const days = breakEven.days_by_regime[r.id]
              return (
                <div key={r.id} className="regimes__row" role="row">
                  <span role="cell" className="regimes__label">
                    {r.label}
                  </span>
                  <span role="cell" className={`regimes__days ${days === null ? 'regimes__days--never' : ''}`}>
                    {formatDays(days)}
                  </span>
                  <span role="cell" className="regimes__note">
                    {r.note}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="breakEven__foot">
            A flat regime is shown as the optimistic bound, not a forecast. The Index&apos;s own published cycles fell
            97% across five hours on 26&ndash;27 Aug 2026, and Quotrons states in its risk section that early rates are
            not representative. Income here is a share of other people&apos;s trading volume; when the volume stops, so
            does the income.
          </p>
        </>
      ) : (
        <div className="breakEven__blocked" role="status">
          <span className="mono-label">{holderPays ? 'HORIZON NOT COMPUTED' : 'NOTHING TO COMPUTE'}</span>
          <p className={holderPays ? '' : 'breakEven__blockedEmph'}>{breakEven.blocked_by}</p>
          {!holderPays && (
            <p>
              To earn from this venue you must burn the token, which is irreversible. That is a different decision from
              holding one, and the one its own documentation is clearest about.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
