import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ScenePlate from '../components/ScenePlate'
import { AppShell } from '../components/AppShell'
import TxPreview from '../components/TxPreview'
import { EmptyState, ErrorState, Skeleton, SourceTag, VerdictTag } from '../components/ui'
import { fetchOpportunity } from '../lib/adapters'
import { evaluatePolicy, formatDuration, simulate } from '../lib/policy'
import { DEFAULT_MANDATE, type PreparedTransaction, type SimulationInput } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import './Recipe.css'

const HOLDING_STEPS = [1, 7, 14, 30, 60, 90, 180]
const REVERSAL_LABELS = ['NONE', 'MILD', 'MODERATE', 'STRONG', 'SEVERE'] as const
const pct = (n: number) => `${(n * 100).toFixed(2)}%`
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

const RESPONSE_COPY: Record<string, { label: string; tone: string }> = {
  continue: { label: 'CONTINUE', tone: 'ok' },
  request_approval: { label: 'REQUEST APPROVAL', tone: 'review' },
  reduce_position: { label: 'REDUCE POSITION', tone: 'review' },
  stop: { label: 'STOP', tone: 'stop' },
}

export default function Recipe() {
  const { recipeId } = useParams()
  const { mandate } = useAgent()
  const active = mandate ?? DEFAULT_MANDATE

  const {
    data: opportunity,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['opportunity', recipeId],
    queryFn: ({ signal }) => fetchOpportunity(recipeId ?? '', signal),
    enabled: Boolean(recipeId),
  })

  const [capital, setCapital] = useState(active.capital_usd)
  const [holdingIdx, setHoldingIdx] = useState(3)
  const [stress, setStress] = useState(0)
  const [reversal, setReversal] = useState<SimulationInput['funding_reversal']>(0)
  const [shock, setShock] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)

  const input: SimulationInput = useMemo(
    () => ({
      capital_usd: capital,
      holding_days: HOLDING_STEPS[holdingIdx],
      market_stress_pct: stress,
      funding_reversal: reversal,
      liquidity_shock_pct: shock,
    }),
    [capital, holdingIdx, stress, reversal, shock],
  )

  const simulation = useMemo(() => (opportunity ? simulate(opportunity, input) : null), [opportunity, input])
  const policy = useMemo(
    () => (opportunity && simulation ? evaluatePolicy(active, opportunity, simulation, capital) : null),
    [opportunity, simulation, active, capital],
  )

  const prepared: PreparedTransaction | null = useMemo(() => {
    if (!opportunity || !simulation || !policy) return null
    return {
      recipe_id: opportunity.recipe_id,
      recipe_name: opportunity.name,
      capital_usd: capital,
      risk_score: opportunity.risk_score,
      steps: [
        {
          venue: `${opportunity.curator} · Morpho`,
          action: `Deposit ${opportunity.inputs.base_asset} into ${opportunity.name} vault`,
          amount_usd: capital,
          contract: opportunity.vault_address,
        },
      ],
      estimated_gas_usd: 0.02,
      policy,
      simulation,
      prepared_at: Date.now(),
    }
  }, [opportunity, simulation, policy, capital])

  return (
    <AppShell plate={<ScenePlate scene="kaji-recipe" className="recipePage__plate" />}>
      <div className="recipePage__scrim" aria-hidden="true" />

      {isPending && (
        <div className="recipePage__state">
          <Skeleton rows={4} label="Loading recipe" />
        </div>
      )}

      {isError && (
        <div className="recipePage__state">
          <ErrorState title="Recipe unavailable" body="The venue read did not complete." onRetry={() => refetch()} />
        </div>
      )}

      {!isPending && !isError && !opportunity && (
        <div className="recipePage__state">
          <EmptyState
            title="No such recipe"
            body="That recipe isn't in the current book. The scanner lists everything the foundry can assemble right now."
            action={
              <Link to="/opportunities" className="btn-lime">
                BACK TO SCANNER <span aria-hidden="true">→</span>
              </Link>
            }
          />
        </div>
      )}

      {opportunity && simulation && policy && (
        <>
          <div className="recipePage__inputBadges" aria-hidden="true">
            {opportunity.ingredients.slice(0, 3).map((ing) => (
              <div key={ing.label} className="inputBadge">
                <span className="inputBadge__head">{ing.label.toUpperCase()}</span>
                <span className="inputBadge__tag">
                  INPUT <b>{ing.weight}%</b>
                </span>
              </div>
            ))}
          </div>

          <div className="recipePage__body">
            <div className="recipePage__left">
              <Link to="/opportunities" className="backLink mono-label">
                ← BACK TO SCANNER
              </Link>
              <h1 className="display-h1 recipePage__h1">
                {opportunity.name}
                <span className="lime-period">.</span>
              </h1>
              <p className="recipePage__desc">
                {opportunity.ingredients.map((i) => i.label).join(', ')} — assembled under one mandate and validated
                before anything reaches your wallet.
              </p>

              <div className="statGrid" role="group" aria-label="Recipe estimates">
                <div className="statGrid__cell">
                  <span className="mono-label">EST. NET CARRY</span>
                  <span className="statGrid__value statGrid__value--lime">{pct(simulation.net_carry)}</span>
                </div>
                <div className="statGrid__cell">
                  <span className="mono-label">GROSS</span>
                  <span className="statGrid__value">{pct(opportunity.gross_apy)}</span>
                </div>
                <div className="statGrid__cell">
                  <span className="mono-label">RISK</span>
                  <span className="statGrid__value">
                    {opportunity.risk_score}
                    <span className="statGrid__sub"> /100</span>
                  </span>
                </div>
                <div className="statGrid__cell">
                  <span className="mono-label">EXIT LIQUIDITY</span>
                  <span className="statGrid__value statGrid__value--lime">{usd(simulation.realizable_exit_usd)}</span>
                </div>
                <div className="statGrid__cell">
                  <span className="mono-label">ORACLE AGE</span>
                  <span
                    className="statGrid__value"
                    title={`Chainlink heartbeat ${formatDuration(opportunity.oracle_heartbeat_seconds)}`}
                  >
                    {formatDuration(opportunity.oracle_age_seconds)}
                  </span>
                </div>
                <div className="statGrid__cell">
                  <span className="mono-label">DATA SOURCE</span>
                  <div className="statGrid__oracleRow">
                    <SourceTag source={opportunity.source} />
                  </div>
                </div>
              </div>

              <details className="carryBreakdown">
                <summary className="carryBreakdown__summary">
                  <span className="mono-label">NET CARRY BREAKDOWN</span>
                  <span className="carryBreakdown__hint mono-label">EVERY COST, ITEMISED</span>
                </summary>
                <dl className="carryBreakdown__list">
                  {(
                    [
                      ['Lending yield', opportunity.breakdown.lending_yield, '+'],
                      ['Funding income', opportunity.breakdown.funding_income, '+'],
                      ['Incentives', opportunity.breakdown.incentive_value, '+'],
                      ['Borrow cost', opportunity.breakdown.borrow_cost, '−'],
                      ['Hedge cost', opportunity.breakdown.hedge_cost, '−'],
                      ['Protocol fees', opportunity.breakdown.protocol_fees, '−'],
                      ['Est. slippage', opportunity.breakdown.estimated_slippage, '−'],
                      ['Annualized gas', opportunity.breakdown.annualized_gas_cost, '−'],
                    ] as const
                  ).map(([label, value, sign]) => (
                    <div key={label} className={`carryRow ${sign === '−' ? 'carryRow--cost' : ''}`}>
                      <dt>{label}</dt>
                      <dd>
                        {sign} {pct(value)}
                      </dd>
                    </div>
                  ))}
                  <div className="carryRow carryRow--total">
                    <dt>Estimated net carry</dt>
                    <dd>{pct(opportunity.estimated_net_carry)}</dd>
                  </div>
                </dl>
              </details>
            </div>

            <aside className="mandateCard" aria-label="Policy status">
              <div className="mandateCard__head">
                <span className="mono-label">POLICY CHECK</span>
                <VerdictTag verdict={policy.verdict} />
              </div>
              {policy.checks.map((c) => (
                <div key={c.id} className={`mandateCard__row mandateCard__row--${c.verdict}`}>
                  <span className="mandateCard__key">{c.label}</span>
                  <span className="mandateCard__value">
                    {c.observed}
                    <span className="mandateCard__bound"> / {c.bound}</span>
                  </span>
                </div>
              ))}
              <Link to="/mandates/new" className="mandateCard__edit mono-label">
                EDIT MANDATE →
              </Link>
            </aside>
          </div>

          <div className="simulator">
            <div className="simulator__controls">
              <span className="mono-label simulator__title">SIMULATOR</span>
              <div className="simulator__grid">
                <div className="simControl">
                  <label className="mono-label" htmlFor="sim-capital">
                    CAPITAL ALLOCATED
                  </label>
                  <output className="simControl__valueBox" htmlFor="sim-capital">
                    {usd(capital)}
                  </output>
                  <input
                    id="sim-capital"
                    type="range"
                    min={1000}
                    max={Math.max(active.capital_usd * 2, 100_000)}
                    step={1000}
                    value={capital}
                    onChange={(e) => setCapital(Number(e.target.value))}
                  />
                  <div className="simControl__range mono-label">
                    <span>$1K</span>
                    <span>CAP {usd(active.capital_usd)}</span>
                  </div>
                </div>

                <div className="simControl">
                  <label className="mono-label" htmlFor="sim-holding">
                    HOLDING PERIOD
                  </label>
                  <output className="simControl__valueBox" htmlFor="sim-holding">
                    {HOLDING_STEPS[holdingIdx]} DAYS
                  </output>
                  <input
                    id="sim-holding"
                    type="range"
                    min={0}
                    max={HOLDING_STEPS.length - 1}
                    value={holdingIdx}
                    onChange={(e) => setHoldingIdx(Number(e.target.value))}
                  />
                  <div className="simControl__range mono-label">
                    <span>1D</span>
                    <span>180D</span>
                  </div>
                </div>

                <div className="simControl">
                  <label className="mono-label" htmlFor="sim-stress">
                    MARKET STRESS
                  </label>
                  <output className="simControl__valueBox" htmlFor="sim-stress">
                    {stress > 0 ? `+${stress}%` : `${stress}%`}
                  </output>
                  <input
                    id="sim-stress"
                    type="range"
                    min={-20}
                    max={20}
                    value={stress}
                    onChange={(e) => setStress(Number(e.target.value))}
                  />
                  <div className="simControl__range mono-label">
                    <span>-20%</span>
                    <span>+20%</span>
                  </div>
                </div>

                <div className="simControl">
                  <label className="mono-label" htmlFor="sim-reversal">
                    FUNDING REVERSAL
                  </label>
                  <output className="simControl__valueBox" htmlFor="sim-reversal">
                    {REVERSAL_LABELS[reversal]}
                  </output>
                  <input
                    id="sim-reversal"
                    type="range"
                    min={0}
                    max={4}
                    value={reversal}
                    onChange={(e) => setReversal(Number(e.target.value) as SimulationInput['funding_reversal'])}
                  />
                  <div className="simControl__range mono-label">
                    <span>NONE</span>
                    <span>SEVERE</span>
                  </div>
                </div>

                <div className="simControl">
                  <label className="mono-label" htmlFor="sim-shock">
                    LIQUIDITY SHOCK
                  </label>
                  <output className="simControl__valueBox" htmlFor="sim-shock">
                    {shock}%
                  </output>
                  <input
                    id="sim-shock"
                    type="range"
                    min={-100}
                    max={0}
                    value={shock}
                    onChange={(e) => setShock(Number(e.target.value))}
                  />
                  <div className="simControl__range mono-label">
                    <span>-100%</span>
                    <span>0%</span>
                  </div>
                </div>
              </div>

              <p className="simulator__result" role="status" aria-live="polite">
                <span className="simulator__resultKey mono-label">SIMULATED</span>
                <span className="simulator__resultValue">{pct(simulation.net_carry)}</span>
                <span className="mono-label">NET CARRY</span>
                <span className="simulator__resultSep" aria-hidden="true">
                  ·
                </span>
                <span className="simulator__resultValue simulator__resultValue--plain">
                  {simulation.max_drawdown_pct.toFixed(2)}%
                </span>
                <span className="mono-label">MAX DRAWDOWN</span>
                <span className="simulator__resultSep" aria-hidden="true">
                  ·
                </span>
                <span className="simulator__resultValue simulator__resultValue--plain">
                  {simulation.pnl_usd >= 0 ? '+' : ''}
                  {usd(simulation.pnl_usd)}
                </span>
                <span className="mono-label">OVER {HOLDING_STEPS[holdingIdx]}D · ESTIMATE ONLY</span>
              </p>

              {simulation.breaches.length > 0 && (
                <p className="simulator__breach" role="alert">
                  Under these conditions: {simulation.breaches.join('; ')}.
                </p>
              )}
            </div>

            <div className="simulator__actions">
              <button
                className="simulator__run"
                onClick={() => setPreviewOpen(true)}
                disabled={policy.verdict === 'block'}
              >
                {policy.verdict === 'block' ? 'BLOCKED BY POLICY' : 'PREPARE TRANSACTION'}{' '}
                <span aria-hidden="true">→</span>
              </button>
              <span className="simulator__actionNote mono-label">
                {policy.verdict === 'block'
                  ? 'ADJUST THE MANDATE OR ALLOCATION'
                  : 'YOU REVIEW EVERY STEP BEFORE SIGNING'}
              </span>
            </div>
          </div>

          <footer className="breakRail">
            <span className="breakRail__title">WHAT CAN BREAK</span>
            {simulation.scenarios.slice(0, 3).map((s) => (
              <div key={s.id} className="breakRail__item">
                <div>
                  <span className="breakRail__name mono-label">{s.label}</span>
                  <p>{s.detail}</p>
                </div>
                <span className={`breakRail__resp breakRail__resp--${RESPONSE_COPY[s.response].tone}`}>
                  {RESPONSE_COPY[s.response].label}
                </span>
              </div>
            ))}
            <Link to="/security" className="breakRail__report mono-label">
              FULL RISK MODEL <span aria-hidden="true">→</span>
            </Link>
          </footer>

          <TxPreview open={previewOpen} onClose={() => setPreviewOpen(false)} tx={prepared} />
        </>
      )}
    </AppShell>
  )
}
