import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ScenePlate from '../components/ScenePlate'
import { AppShell } from '../components/AppShell'
import { Dialog, EmptyState, ErrorState, Skeleton, SourceTag, VerdictTag } from '../components/ui'
import MandateForm from '../components/MandateForm'
import { fetchOpportunities } from '../lib/adapters'
import { evaluatePolicy, formatDuration, simulate } from '../lib/policy'
import { DEFAULT_MANDATE, type Opportunity, type RiskMode } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import './Scanner.css'

const RISK_MODES: RiskMode[] = ['conservative', 'measured', 'opportunistic']
const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`
const pct = (n: number) => `${(n * 100).toFixed(2)}%`

function OutputIcon({ id }: { id: string }) {
  if (id === 'steady-press')
    return (
      <svg viewBox="0 0 48 48" className="scanRow__icon" aria-hidden="true">
        <circle cx="24" cy="24" r="14" fill="none" stroke="#8e938c" strokeWidth="9" />
        <circle cx="24" cy="24" r="14" fill="none" stroke="#4c504a" strokeWidth="3" />
      </svg>
    )
  if (id === 'carry-alloy')
    return (
      <svg viewBox="0 0 48 48" className="scanRow__icon" aria-hidden="true">
        <path d="M14 32 10 22l9-10 12-3 8 9-2 12-10 8z" fill="#6c716a" stroke="#3a3e39" strokeWidth="2" />
        <path d="M19 12l6 9-11 1z" fill="#84887f" />
      </svg>
    )
  return (
    <svg viewBox="0 0 48 48" className="scanRow__icon" aria-hidden="true">
      <path d="M12 14h24v6h-9v10h9v6H12v-6h9V20h-9z" fill="#8e938c" stroke="#4c504a" strokeWidth="2" />
    </svg>
  )
}

export default function Scanner() {
  const { mandate, totalCapital } = useAgent()
  const active = mandate ?? DEFAULT_MANDATE
  const [riskFilter, setRiskFilter] = useState<RiskMode | 'all'>('all')
  const [hideBlocked, setHideBlocked] = useState(false)

  /**
   * `?limits=1` opens the drawer on arrival, so the old /mandates/new links —
   * and anyone's bookmark of them — still land somewhere that works.
   */
  const [params, setParams] = useSearchParams()
  const [limitsOpen, setLimitsOpen] = useState(params.has('limits'))

  function closeLimits() {
    setLimitsOpen(false)
    if (params.has('limits')) {
      params.delete('limits')
      setParams(params, { replace: true })
    }
  }

  const {
    data: opportunities,
    isPending,
    isError,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['opportunities'],
    queryFn: ({ signal }) => fetchOpportunities(signal),
  })

  /**
   * Each row carries its own policy verdict against the current mandate, so the
   * scanner never advertises something the engine would refuse.
   *
   * The allocation each row is judged at is the mandate's *remaining* headroom,
   * not its full cap — that is the size a user could actually still take. With
   * no headroom left the row is judged at the full cap so the spend check
   * blocks and says why, rather than silently previewing a $0 deposit.
   */
  const evaluated = useMemo(() => {
    if (!opportunities) return []
    const headroom = Math.max(0, active.capital_usd - totalCapital)
    const previewCapital = headroom > 0 ? headroom : active.capital_usd
    return opportunities.map((o: Opportunity) => {
      const sim = simulate(o, {
        capital_usd: previewCapital,
        holding_days: 30,
        market_stress_pct: 0,
        funding_reversal: 0,
        liquidity_shock_pct: 0,
      })
      return { opportunity: o, policy: evaluatePolicy(active, o, sim, previewCapital, totalCapital) }
    })
  }, [opportunities, active, totalCapital])

  const rows = useMemo(
    () =>
      evaluated
        .filter((r) => (riskFilter === 'all' ? true : r.opportunity.profile === riskFilter))
        .filter((r) => (hideBlocked ? r.policy.verdict !== 'block' : true)),
    [evaluated, riskFilter, hideBlocked],
  )

  const blockedCount = useMemo(() => evaluated.filter((r) => r.policy.verdict === 'block').length, [evaluated])

  return (
    <AppShell plate={<ScenePlate scene="kaji-scanner" className="scanner__plate" />}>
      <div className="scanner__scrim" aria-hidden="true" />

      <div className="scanner__hero">
        <div className="scanner__copy">
          <h1 className="display-h1 scanner__h1">
            Find the
            <br />
            cleanest output<span className="lime-period">.</span>
          </h1>

          <div className="filterRail" role="group" aria-label="Scanner filters">
            <div className="filterRail__cell">
              <span className="mono-label" id="f-capital">
                CAPITAL
              </span>
              <span className="filterRail__value" aria-labelledby="f-capital">
                {usd(active.capital_usd)}
              </span>
              {!mandate && <span className="filterRail__hint mono-label">DEFAULT</span>}
            </div>

            <div className="filterRail__cell">
              <label className="mono-label" htmlFor="f-risk">
                RISK
              </label>
              <select
                id="f-risk"
                className="filterRail__select"
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value as RiskMode | 'all')}
              >
                <option value="all">ALL</option>
                {RISK_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div className="filterRail__cell">
              <span className="mono-label" id="f-lev">
                LEVERAGE
              </span>
              <span className="filterRail__value filterRail__value--lime" aria-labelledby="f-lev">
                {active.allow_leverage ? 'ON' : 'OFF'}
              </span>
            </div>

            <div className="filterRail__cell">
              <label className="mono-label" htmlFor="f-blocked">
                POLICY
              </label>
              <label className="filterRail__toggle" htmlFor="f-blocked">
                <input
                  id="f-blocked"
                  type="checkbox"
                  checked={hideBlocked}
                  onChange={(e) => setHideBlocked(e.target.checked)}
                />
                <span>HIDE BLOCKED</span>
              </label>
            </div>

            <div className="filterRail__cell filterRail__cell--action">
              <span className="mono-label">LIMITS</span>
              <button type="button" className="filterRail__edit" onClick={() => setLimitsOpen(true)}>
                EDIT <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>

          {!mandate && (
            <p className="scanner__mandateHint">
              Ranking against the default mandate.{' '}
              <button type="button" className="scanner__mandateLink" onClick={() => setLimitsOpen(true)}>
                Set your own limits
              </button>{' '}
              to filter these results against real constraints.
            </p>
          )}
        </div>
      </div>

      <div className="scanTable">
        {isPending && <Skeleton rows={3} label="Scanning venues" />}

        {isError && (
          <ErrorState
            title="Scan failed"
            body={
              error instanceof Error
                ? `${error.message} No estimates are shown rather than stale ones.`
                : 'The venue scan did not complete. No estimates are shown rather than stale ones.'
            }
            onRetry={() => refetch()}
          />
        )}

        {!isPending && !isError && rows.length === 0 && (
          <EmptyState
            title="Nothing clears your mandate"
            body={
              blockedCount > 0
                ? `${blockedCount} recipe${blockedCount > 1 ? 's are' : ' is'} blocked by your current limits. Widen exit liquidity, raise the slippage ceiling, or clear the risk filter to see them.`
                : 'No recipe matches this filter right now. Clear the risk filter or check back after the next scan.'
            }
            action={
              <button type="button" className="btn-outline" onClick={() => setLimitsOpen(true)}>
                ADJUST LIMITS <span aria-hidden="true">→</span>
              </button>
            }
          />
        )}

        {rows.length > 0 && (
          <div className="scanTable__grid" role="table" aria-label="Ranked opportunities">
            <div className="scanTable__head" role="row">
              <span role="columnheader" className="mono-label">
                OUTPUT
              </span>
              <span role="columnheader" className="mono-label">
                NET CARRY
              </span>
              <span role="columnheader" className="mono-label">
                RISK
              </span>
              <span role="columnheader" className="mono-label">
                EXIT LIQUIDITY
              </span>
              <span role="columnheader" className="mono-label">
                INCOME BASIS
              </span>
              <span role="columnheader" className="mono-label">
                POLICY
              </span>
              <span role="columnheader" className="visually-hidden">
                Action
              </span>
            </div>

            {rows.map(({ opportunity: o, policy }) => (
              <div key={o.recipe_id} className={`scanRow scanRow--${policy.verdict}`} role="row">
                <div className="scanRow__output" role="cell">
                  <OutputIcon id={o.recipe_id} />
                  <div>
                    <div className="scanRow__name">{o.name}</div>
                    <div className="mono-label scanRow__sub">{o.subtitle}</div>
                  </div>
                </div>

                {/* A vault pays a rate; a distribution token charges to enter
                    and pays a share of somebody else's volume. Printing one
                    number under one heading would flatten that difference away,
                    so the cell reports whichever measure the venue actually has. */}
                <div role="cell" className="scanRow__carry">
                  {o.distribution ? (
                    <>
                      <span className="scanRow__carryValue scanRow__carryValue--cost">
                        −{((o.distribution.entry_fee_bps + o.distribution.exit_fee_bps) / 100).toFixed(2)}%
                      </span>
                      <span className="scanRow__delta">ROUND TRIP TO ENTER</span>
                    </>
                  ) : (
                    <>
                      <span className="scanRow__carryValue">{pct(o.estimated_net_carry)}</span>
                      <span className="scanRow__delta">{pct(o.gross_apy)} GROSS</span>
                    </>
                  )}
                </div>

                <div role="cell" className="scanRow__risk">
                  <span className="scanRow__riskValue">
                    {o.risk_score}
                    <span className="scanRow__riskDen"> /100</span>
                  </span>
                  <span className="mono-label">{o.profile.toUpperCase()}</span>
                </div>

                <div role="cell" className="scanRow__liq">
                  <span className="scanRow__liqValue">
                    {o.exit_liquidity_usd >= active.min_exit_liquidity_usd * 4
                      ? 'HIGH'
                      : o.exit_liquidity_usd >= active.min_exit_liquidity_usd
                        ? 'MEDIUM'
                        : 'LOW'}
                  </span>
                  {/* Depth is not market capitalisation and must not read like
                      it: this is what a seller can take out before the price
                      moves against them by the stated amount. */}
                  <span className="mono-label" title={o.distribution ? 'Quote asset obtainable before a 5% price fall, from in-range pool liquidity' : 'Liquid share of the vault'}>
                    {o.distribution
                      ? `≥ ${usd(o.exit_liquidity_usd)} @ 5% IMPACT`
                      : `${usd(o.exit_liquidity_usd)} VAULT LIQUIDITY`}
                  </span>
                </div>

                <div role="cell" className="scanRow__oracle">
                  {o.distribution ? (
                    <span
                      className={`scanRow__oracleValue ${!o.distribution.pays_holders ? 'scanRow__oracleValue--stale' : ''}`}
                      title={o.distribution.share_basis}
                    >
                      {!o.distribution.pays_holders
                        ? 'PAYS NOTHING'
                        : o.distribution.interval_seconds
                          ? `${Math.round(o.distribution.interval_seconds / 60)}m CYCLE`
                          : 'CADENCE UNKNOWN'}
                    </span>
                  ) : (
                    <span
                      className={`scanRow__oracleValue ${(o.oracle_age_seconds ?? 0) > (o.oracle_heartbeat_seconds ?? Infinity) ? 'scanRow__oracleValue--stale' : ''}`}
                      title={`Chainlink heartbeat ${formatDuration(o.oracle_heartbeat_seconds ?? 0)}`}
                    >
                      {formatDuration(o.oracle_age_seconds ?? 0)} ORACLE
                    </span>
                  )}
                  <SourceTag source={o.source} />
                </div>

                <div role="cell" className="scanRow__policy">
                  <VerdictTag verdict={policy.verdict} />
                  <span className="mono-label scanRow__policyDetail">
                    {/* Name the check that produced this verdict, not merely
                        the first that was not a pass — a row blocked on cost
                        must not be labelled with an unrelated review. */}
                    {policy.verdict === 'pass'
                      ? 'WITHIN MANDATE'
                      : (policy.checks.find((c) => c.verdict === policy.verdict)?.label ?? '').toUpperCase()}
                  </span>
                </div>

                <div role="cell">
                  <Link
                    to={`/recipes/${o.recipe_id}`}
                    className="scanRow__inspect"
                    aria-label={`Inspect ${o.name}, estimated net carry ${pct(o.estimated_net_carry)}`}
                  >
                    INSPECT <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="scanner__footer">
        <div className="scanner__footerLeft">
          <span className="mono-label">FOUNDRY SCANNER</span>
          <span className="mono-label">
            RANKED BY NET CARRY PER UNIT OF RISK
          </span>
        </div>
        <div className="scanner__footerRight">
          <span className="mono-label">
            {dataUpdatedAt ? `SCANNED ${new Date(dataUpdatedAt).toLocaleTimeString()}` : 'SCANNING…'}
          </span>
          <button className="scanner__rescan mono-label" onClick={() => refetch()} disabled={isPending}>
            RESCAN
          </button>
        </div>
      </footer>

      <Dialog open={limitsOpen} onClose={closeLimits} labelledBy="limits-title" className="limitsDialog">
        <div className="limitsDialog__head">
          <h2 id="limits-title" className="limitsDialog__title">
            Machine limits
          </h2>
          <p className="limitsDialog__sub">
            Every row in the table is judged against these. Change one and the verdicts change with it.
          </p>
        </div>
        <MandateForm onSaved={closeLimits} />
      </Dialog>
    </AppShell>
  )
}
