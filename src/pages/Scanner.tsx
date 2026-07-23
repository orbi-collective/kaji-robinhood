import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ScenePlate from '../components/ScenePlate'
import { Sparkline } from '../components/Sparkline'
import { AppShell } from '../components/AppShell'
import { EmptyState, ErrorState, Skeleton, SourceTag, VerdictTag } from '../components/ui'
import { fetchOpportunities } from '../lib/adapters'
import { evaluatePolicy, formatDuration, simulate } from '../lib/policy'
import { DEFAULT_MANDATE, type Opportunity, type RiskMode } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import './Scanner.css'

const RISK_MODES: RiskMode[] = ['conservative', 'measured', 'opportunistic']
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`)
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
  const { mandate } = useAgent()
  const active = mandate ?? DEFAULT_MANDATE
  const [riskFilter, setRiskFilter] = useState<RiskMode | 'all'>('all')
  const [hideBlocked, setHideBlocked] = useState(false)

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

  /** Each row carries its own policy verdict against the current mandate, so the
   *  scanner never advertises something the engine would refuse. */
  const rows = useMemo(() => {
    if (!opportunities) return []
    return opportunities
      .map((o: Opportunity) => {
        const sim = simulate(o, {
          capital_usd: active.capital_usd,
          holding_days: 30,
          market_stress_pct: 0,
          funding_reversal: 0,
          liquidity_shock_pct: 0,
        })
        return { opportunity: o, policy: evaluatePolicy(active, o, sim, active.capital_usd) }
      })
      .filter((r) => (riskFilter === 'all' ? true : r.opportunity.profile === riskFilter))
      .filter((r) => (hideBlocked ? r.policy.verdict !== 'block' : true))
  }, [opportunities, active, riskFilter, hideBlocked])

  const blockedCount = useMemo(
    () =>
      (opportunities ?? []).filter((o) => {
        const sim = simulate(o, {
          capital_usd: active.capital_usd,
          holding_days: 30,
          market_stress_pct: 0,
          funding_reversal: 0,
          liquidity_shock_pct: 0,
        })
        return evaluatePolicy(active, o, sim, active.capital_usd).verdict === 'block'
      }).length,
    [opportunities, active],
  )

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
          </div>

          {!mandate && (
            <p className="scanner__mandateHint">
              Ranking against the default mandate.{' '}
              <Link to="/mandates/new" className="scanner__mandateLink">
                Set your own limits
              </Link>{' '}
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
              <Link to="/mandates/new" className="btn-outline">
                ADJUST MANDATE <span aria-hidden="true">→</span>
              </Link>
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
                ORACLE AGE
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

                <div role="cell" className="scanRow__carry">
                  <span className="scanRow__carryValue">{pct(o.estimated_net_carry)}</span>
                  <Sparkline points={o.trace} width={90} height={20} down={o.trend_24h < 0} />
                  <span className={`scanRow__delta ${o.trend_24h < 0 ? 'scanRow__delta--down' : ''}`}>
                    {o.trend_24h < 0 ? '↓' : '↑'} {Math.abs(o.trend_24h * 100).toFixed(2)}% (24H)
                  </span>
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
                  <span className="mono-label">{usd(o.exit_liquidity_usd)} DEPTH</span>
                </div>

                <div role="cell" className="scanRow__oracle">
                  <span
                    className={`scanRow__oracleValue ${o.oracle_age_seconds > o.oracle_heartbeat_seconds ? 'scanRow__oracleValue--stale' : ''}`}
                    title={`Chainlink heartbeat ${formatDuration(o.oracle_heartbeat_seconds)}`}
                  >
                    {formatDuration(o.oracle_age_seconds)}
                  </span>
                  <SourceTag source={o.source} />
                </div>

                <div role="cell" className="scanRow__policy">
                  <VerdictTag verdict={policy.verdict} />
                  <span className="mono-label scanRow__policyDetail">
                    {policy.verdict === 'pass'
                      ? 'WITHIN MANDATE'
                      : (policy.checks.find((c) => c.verdict !== 'pass')?.label ?? '').toUpperCase()}
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
    </AppShell>
  )
}
