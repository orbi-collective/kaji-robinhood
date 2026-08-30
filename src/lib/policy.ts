import type {
  BreakEven,
  Mandate,
  Opportunity,
  PolicyCheck,
  PolicyResult,
  PolicyVerdict,
  SimulationInput,
  SimulationResult,
  StressScenario,
} from './types'

/**
 * Deterministic policy engine.
 *
 * The scanner may surface anything; nothing is offered for signature unless
 * every check here passes. Pure functions, no network, no randomness — the same
 * inputs always produce the same verdict, which is what makes it auditable.
 */

/** Falls back only when a feed reports no heartbeat of its own. */
const DEFAULT_ORACLE_HEARTBEAT = 3600
const usd = (n: number) =>
  `$${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1000)}K` : n.toFixed(0)}`

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
  return `${Math.floor(seconds / 86_400)}d`
}

function worst(verdicts: PolicyVerdict[]): PolicyVerdict {
  if (verdicts.includes('block')) return 'block'
  if (verdicts.includes('review')) return 'review'
  return 'pass'
}

export function evaluatePolicy(
  mandate: Mandate,
  opportunity: Opportunity,
  simulation: SimulationResult,
  capitalUsd: number,
  /**
   * Capital the mandate is already carrying in open positions. The cap is a
   * budget across every position, not a per-transaction limit — checking this
   * allocation alone would let three $1k deposits pass a $1k mandate.
   */
  deployedUsd = 0,
  /**
   * Present for venues that charge to enter. The horizon check is skipped
   * rather than passed when this is absent — a missing measurement is not
   * evidence that a position repays quickly.
   */
  breakEven?: BreakEven | null,
): PolicyResult {
  const checks: PolicyCheck[] = []

  const venues = [opportunity.inputs.venue, opportunity.inputs.hedge_venue].filter(
    (v): v is string => Boolean(v),
  )
  const offAllowlist = venues.filter((v) => !mandate.protocol_allowlist.includes(v))
  checks.push({
    id: 'protocol_allowlist',
    label: 'Protocol allowlist',
    verdict: offAllowlist.length ? 'block' : 'pass',
    detail: offAllowlist.length
      ? `${offAllowlist.join(', ')} is not on the mandate allowlist.`
      : 'All interactions on approved list.',
    bound: mandate.protocol_allowlist.join(', '),
    observed: venues.join(', ') || 'none',
  })

  // A mandate denominated in one asset must not be spent in another — the
  // recipe's own base asset is the thing the wallet is actually asked for.
  const allowed = mandate.base_assets.map((a) => a.toUpperCase())
  const assetOk = allowed.includes(opportunity.inputs.base_asset.toUpperCase())
  checks.push({
    id: 'base_asset',
    label: 'Base asset',
    verdict: assetOk ? 'pass' : 'block',
    detail: assetOk
      ? 'Recipe settles in an asset the mandate authorises.'
      : `Recipe settles in ${opportunity.inputs.base_asset}, which the mandate does not authorise.`,
    bound: allowed.join(', '),
    observed: opportunity.inputs.base_asset,
  })

  /**
   * Depth on a distribution row is a *lower bound* — it counts only the
   * liquidity sitting in the pool's current tick range. A lower bound can prove
   * that depth exists; it can never prove depth is absent, because more may sit
   * outside the range. So falling under the floor cannot justify a block here,
   * only a review. Vault liquidity is a direct reading and blocks as before.
   */
  const isBound = opportunity.kind === 'distribution'
  const liquidityOk = opportunity.exit_liquidity_usd >= mandate.min_exit_liquidity_usd
  checks.push({
    id: 'exit_liquidity',
    label: 'Exit liquidity',
    verdict: liquidityOk ? 'pass' : isBound ? 'review' : 'block',
    detail: liquidityOk
      ? isBound
        ? 'Depth provable from in-range liquidity already clears the mandate floor.'
        : 'Exit depth above mandate floor.'
      : isBound
        ? 'In-range liquidity does not prove enough depth to clear the floor. More may sit outside the current range, so this is unproven rather than refused — quote the exit before committing.'
        : 'Exit depth below the mandate floor — position could not be unwound within limits.',
    bound: `≥ ${usd(mandate.min_exit_liquidity_usd)}`,
    observed: isBound ? `≥ ${usd(opportunity.exit_liquidity_usd)}` : usd(opportunity.exit_liquidity_usd),
  })

  const slippageBps = Math.round(opportunity.breakdown.estimated_slippage * 10_000)
  const slippageOk = slippageBps <= mandate.max_slippage_bps
  checks.push({
    id: 'slippage',
    label: 'Slippage',
    verdict: slippageOk ? 'pass' : 'block',
    detail: slippageOk ? 'Projected slippage within policy limit.' : 'Projected slippage exceeds the mandate ceiling.',
    bound: `≤ ${(mandate.max_slippage_bps / 100).toFixed(2)}%`,
    observed: `${(slippageBps / 100).toFixed(2)}%`,
  })

  const drawdownBps = Math.round(simulation.max_drawdown_pct * 100)
  const drawdownOk = drawdownBps <= mandate.max_drawdown_bps
  checks.push({
    id: 'drawdown',
    label: 'Drawdown ceiling',
    verdict: drawdownOk ? 'pass' : 'review',
    detail: drawdownOk
      ? 'Simulated drawdown inside the mandate ceiling.'
      : 'Simulated drawdown exceeds the ceiling — needs your approval or a lower allocation.',
    bound: `≤ ${(mandate.max_drawdown_bps / 100).toFixed(2)}%`,
    observed: `${simulation.max_drawdown_pct.toFixed(2)}%`,
  })

  const leverageOk = mandate.allow_leverage || !opportunity.requires_leverage
  checks.push({
    id: 'leverage',
    label: 'Leverage',
    verdict: leverageOk ? 'pass' : 'block',
    detail: leverageOk ? 'No borrowed exposure beyond mandate.' : 'Recipe requires leverage; mandate disallows it.',
    bound: mandate.allow_leverage ? 'permitted' : 'off',
    observed: opportunity.requires_leverage ? 'required' : 'none',
  })

  // A venue that references no oracle cannot have a stale one. Reporting a
  // pass here would imply a freshness guarantee nothing is providing, so the
  // check states the absence instead.
  if (opportunity.oracle_age_seconds === null) {
    checks.push({
      id: 'oracle_freshness',
      label: 'Oracle freshness',
      verdict: 'review',
      detail:
        'This venue references no price oracle. Value is whatever its pool trades at, so there is no stale-price guard to rely on.',
      bound: 'n/a',
      observed: 'no oracle',
    })
  } else {
    const heartbeat = opportunity.oracle_heartbeat_seconds || DEFAULT_ORACLE_HEARTBEAT
    const oracleOk = opportunity.oracle_age_seconds <= heartbeat
    checks.push({
      id: 'oracle_freshness',
      label: 'Oracle freshness',
      verdict: oracleOk ? 'pass' : 'block',
      detail: oracleOk
        ? 'Price feed inside its publisher heartbeat.'
        : 'Price feed past its heartbeat — execution paused until it updates.',
      bound: `≤ ${formatDuration(heartbeat)} heartbeat`,
      observed: formatDuration(opportunity.oracle_age_seconds),
    })
  }

  const committedUsd = capitalUsd + deployedUsd
  const spendOk = committedUsd <= mandate.capital_usd
  checks.push({
    id: 'spend_cap',
    label: 'Spend cap',
    verdict: spendOk ? 'pass' : 'block',
    detail: spendOk
      ? deployedUsd > 0
        ? `This allocation plus ${usd(deployedUsd)} already deployed stays inside the mandate cap.`
        : 'Projected spend within policy limit.'
      : deployedUsd > 0
        ? `This allocation plus ${usd(deployedUsd)} already deployed exceeds the mandate capital cap.`
        : 'Allocation exceeds the mandate capital cap.',
    bound: `≤ ${usd(mandate.capital_usd)}`,
    observed: deployedUsd > 0 ? `${usd(committedUsd)} total` : usd(capitalUsd),
  })

  // Round trip and break-even only mean something where entering costs money.
  if (opportunity.distribution) {
    const roundTripBps = breakEven
      ? breakEven.round_trip_bps
      : opportunity.distribution.entry_fee_bps + opportunity.distribution.exit_fee_bps
    const costOk = roundTripBps <= mandate.max_round_trip_bps
    checks.push({
      id: 'round_trip_cost',
      label: 'Round-trip cost',
      verdict: costOk ? 'pass' : 'block',
      detail: costOk
        ? 'Entry and exit fees together stay inside the mandate ceiling.'
        : 'Entering and leaving this position costs more than the mandate permits.',
      bound: `≤ ${(mandate.max_round_trip_bps / 100).toFixed(2)}%`,
      observed: `${(roundTripBps / 100).toFixed(2)}%`,
    })

    const days = breakEven?.days_by_regime.decay_50_week ?? null
    if (!opportunity.distribution.pays_holders) {
      // Not an unmeasured horizon — an absent one. Holding earns nothing, so
      // the round trip is never repaid by holding at all.
      checks.push({
        id: 'breakeven_horizon',
        label: 'Break-even horizon',
        verdict: 'block',
        detail:
          'Holding this token earns nothing, so its round-trip cost is never repaid by holding it. Earning here requires irreversibly burning the token.',
        bound: `≤ ${mandate.max_breakeven_days}d`,
        observed: 'pays nothing',
      })
    } else if (!breakEven || breakEven.blocked_by) {
      checks.push({
        id: 'breakeven_horizon',
        label: 'Break-even horizon',
        verdict: 'review',
        detail:
          breakEven?.blocked_by ??
          'Break-even could not be computed for this position, so the horizon is unverified.',
        bound: `≤ ${mandate.max_breakeven_days}d`,
        observed: 'not measured',
      })
    } else {
      const horizonOk = days !== null && days <= mandate.max_breakeven_days
      checks.push({
        id: 'breakeven_horizon',
        label: 'Break-even horizon',
        verdict: horizonOk ? 'pass' : 'block',
        detail:
          days === null
            ? 'Under a decaying volume regime this position never repays its own round-trip cost.'
            : horizonOk
              ? 'Income repays the round trip inside the mandate horizon.'
              : 'Income takes longer than the mandate allows to repay the round trip.',
        bound: `≤ ${mandate.max_breakeven_days}d`,
        observed: days === null ? 'never' : `${days.toFixed(1)}d`,
      })
    }
  }

  const simulationOk = simulation.breaches.length === 0
  checks.push({
    id: 'simulation',
    label: 'Transaction simulation',
    verdict: simulationOk ? 'pass' : 'review',
    detail: simulationOk
      ? 'Simulation passed against current state.'
      : `Simulation flagged: ${simulation.breaches.join('; ')}.`,
    bound: 'no breaches',
    observed: simulationOk ? 'clean' : `${simulation.breaches.length} flagged`,
  })

  return { verdict: worst(checks.map((c) => c.verdict)), checks, checked_at: Date.now() }
}

/** Net carry per the brief's equation. Every term is subtracted explicitly. */
export function netCarry(b: Opportunity['breakdown']): number {
  return (
    b.lending_yield +
    b.funding_income +
    b.incentive_value -
    b.borrow_cost -
    b.hedge_cost -
    b.protocol_fees -
    b.estimated_slippage -
    b.annualized_gas_cost
  )
}

const REVERSAL_DRAG = [0, 0.004, 0.011, 0.021, 0.034]

export function simulate(opportunity: Opportunity, input: SimulationInput): SimulationResult {
  const shock = Math.abs(input.liquidity_shock_pct) / 100
  const stress = Math.abs(Math.min(0, input.market_stress_pct)) / 100
  const reversal = REVERSAL_DRAG[input.funding_reversal] ?? 0

  const base = netCarry(opportunity.breakdown)
  // Liquidity shock widens exits; market stress and funding reversal compress carry.
  const slippageDrag = opportunity.breakdown.estimated_slippage * shock * 2.5
  const net = base - reversal - stress * 0.22 - slippageDrag

  const holdingFactor = Math.min(1.6, 0.55 + input.holding_days / 90)
  const maxDrawdown = (0.9 + stress * 14 + reversal * 40 + shock * 2.4) * holdingFactor
  const realizableExit = opportunity.exit_liquidity_usd * (1 - shock)
  const pnl = input.capital_usd * net * (input.holding_days / 365)

  const breaches: string[] = []
  if (net <= 0) breaches.push('net carry turns negative under these conditions')
  if (realizableExit < input.capital_usd) breaches.push('realizable exit depth below allocated capital')
  if (
    opportunity.oracle_age_seconds !== null &&
    opportunity.oracle_age_seconds > (opportunity.oracle_heartbeat_seconds || DEFAULT_ORACLE_HEARTBEAT)
  )
    breaches.push('oracle feed past its heartbeat')

  const scenarios: StressScenario[] = [
    {
      id: 'liquidity',
      label: 'Liquidity −50%',
      response: shock >= 0.5 ? 'reduce_position' : 'continue',
      detail:
        shock >= 0.5
          ? 'Exit depth halves; agent reduces position to stay inside the exit floor.'
          : 'Exit depth stays above the mandate floor.',
    },
    {
      id: 'funding',
      label: 'Funding reversal',
      response: input.funding_reversal >= 3 ? 'request_approval' : 'continue',
      detail:
        input.funding_reversal >= 3
          ? 'Carry compression beyond tolerance; agent requests your approval before rebalancing.'
          : 'Funding regime within tolerance.',
    },
    { id: 'oracle', label: 'Oracle stale', response: 'stop', detail: 'Execution pauses until the feed recovers.' },
    { id: 'slippage', label: 'Slippage breach', response: 'stop', detail: 'Order is not submitted past the ceiling.' },
    { id: 'protocol', label: 'Protocol pause', response: 'stop', detail: 'Agent halts and surfaces the exit path.' },
  ]

  return {
    net_carry: net,
    gross_apy: opportunity.gross_apy,
    max_drawdown_pct: Math.max(0, maxDrawdown),
    realizable_exit_usd: realizableExit,
    pnl_usd: pnl,
    breaches,
    scenarios,
    simulated_at: Date.now(),
  }
}
