/** Domain types. Mirrors the API model in the product brief §13. */

export type RiskMode = 'conservative' | 'measured' | 'opportunistic'
export type ApprovalMode = 'manual' | 'session_key'
export type DataSource = 'live' | 'delayed' | 'demo'

/** A typed mandate. Every executable action is validated against this. */
export type Mandate = {
  capital_usd: number
  base_asset: string
  risk_mode: RiskMode
  max_drawdown_bps: number
  max_slippage_bps: number
  min_exit_liquidity_usd: number
  allow_leverage: boolean
  approval_mode: ApprovalMode
  protocol_allowlist: string[]
  updated_at: number
}

export const DEFAULT_MANDATE: Mandate = {
  capital_usd: 1000,
  base_asset: 'USDG',
  risk_mode: 'measured',
  max_drawdown_bps: 300,
  max_slippage_bps: 75,
  min_exit_liquidity_usd: 250_000,
  allow_leverage: false,
  approval_mode: 'manual',
  protocol_allowlist: ['morpho'],
  updated_at: 0,
}

export type CarryBreakdown = {
  lending_yield: number
  funding_income: number
  incentive_value: number
  borrow_cost: number
  hedge_cost: number
  protocol_fees: number
  estimated_slippage: number
  annualized_gas_cost: number
}

export type Ingredient = { label: string; venue: string; weight: number }

export type Opportunity = {
  recipe_id: string
  name: string
  subtitle: string
  profile: RiskMode
  inputs: { base_asset: string; lending_venue: string; hedge_venue: string | null }
  ingredients: Ingredient[]
  breakdown: CarryBreakdown
  gross_apy: number
  estimated_net_carry: number
  risk_score: number
  exit_liquidity_usd: number
  oracle_age_seconds: number
  /** The feed publisher's own staleness bound — what "stale" actually means here. */
  oracle_heartbeat_seconds: number
  tvl_usd: number | null
  curator: string
  vault_address: `0x${string}`
  /** Names the missing source when a row could not be built from live data. */
  unavailable_reason: string | null
  confidence: number
  requires_leverage: boolean
  trend_24h: number
  trace: number[]
  source: DataSource
  as_of: number
}

/** Deterministic policy engine output. Never advisory — it gates execution. */
export type PolicyCheckId =
  | 'protocol_allowlist'
  | 'exit_liquidity'
  | 'slippage'
  | 'drawdown'
  | 'leverage'
  | 'oracle_freshness'
  | 'spend_cap'
  | 'simulation'

export type PolicyVerdict = 'pass' | 'review' | 'block'

export type PolicyCheck = {
  id: PolicyCheckId
  label: string
  verdict: PolicyVerdict
  detail: string
  /** Human-readable limit this check enforced, e.g. "≤ 0.75%". */
  bound: string
  observed: string
}

export type PolicyResult = {
  verdict: PolicyVerdict
  checks: PolicyCheck[]
  checked_at: number
}

export type StressScenario = {
  id: string
  label: string
  response: 'continue' | 'request_approval' | 'reduce_position' | 'stop'
  detail: string
}

export type SimulationInput = {
  capital_usd: number
  holding_days: number
  market_stress_pct: number
  funding_reversal: 0 | 1 | 2 | 3 | 4
  liquidity_shock_pct: number
}

export type SimulationResult = {
  net_carry: number
  gross_apy: number
  max_drawdown_pct: number
  realizable_exit_usd: number
  pnl_usd: number
  breaches: string[]
  scenarios: StressScenario[]
  simulated_at: number
}

export type PreparedTransaction = {
  recipe_id: string
  recipe_name: string
  capital_usd: number
  risk_score: number
  steps: { venue: string; action: string; amount_usd: number; contract: string }[]
  estimated_gas_usd: number
  policy: PolicyResult
  simulation: SimulationResult
  prepared_at: number
}

export type PositionStatus = 'active' | 'paused' | 'closed'

export type Position = {
  id: string
  recipe_id: string
  recipe_name: string
  capital_usd: number
  entry_net_carry: number
  current_net_carry: number
  risk_score: number
  status: PositionStatus
  tx_hash: string
  opened_at: number
  allocation: Ingredient[]
}

export type AgentEventKind = 'executed' | 'pending' | 'skipped' | 'paused'

export type AgentEvent = {
  id: string
  kind: AgentEventKind
  title: string
  detail: string
  at: number
  /** Present when the event needs a human decision. */
  recommendation?: {
    action: string
    rationale: string
    policy: PolicyVerdict
  }
}
