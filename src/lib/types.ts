/** Domain types. Mirrors the API model in the product brief §13. */

export type RiskMode = 'conservative' | 'measured' | 'opportunistic'
export type ApprovalMode = 'manual' | 'session_key'
export type DataSource = 'live' | 'delayed' | 'demo'

/**
 * The two classes of position PONSAJI prices.
 *
 * `vault` — capital sits in an ERC-4626 vault and compounds. Income is a rate.
 * `distribution` — capital sits in a token whose trading fee buys assets that
 *   are pushed to holders. Income is a share of somebody else's volume, and the
 *   entry and exit each pay a fee. The two are only comparable once every cost
 *   is subtracted, which is the whole reason they share one engine.
 */
export type VenueKind = 'vault' | 'distribution'

/** A typed mandate. Every executable action is validated against this. */
export type Mandate = {
  capital_usd: number
  /**
   * Denominations this mandate authorises. A set rather than one value: the two
   * venue classes settle in different assets, and refusing to say which you
   * hold is not a constraint, it is an omission.
   */
  base_assets: string[]
  risk_mode: RiskMode
  max_drawdown_bps: number
  max_slippage_bps: number
  min_exit_liquidity_usd: number
  /** Ceiling on entry fee + exit fee combined. The cost of a round trip. */
  max_round_trip_bps: number
  /**
   * Longest a position may take to repay its own round-trip cost out of income.
   * Null disables the check — for a venue with no entry fee it is meaningless.
   */
  max_breakeven_days: number
  allow_leverage: boolean
  approval_mode: ApprovalMode
  protocol_allowlist: string[]
  updated_at: number
}

export const DEFAULT_MANDATE: Mandate = {
  capital_usd: 1000,
  base_assets: ['USDG', 'ETH'],
  risk_mode: 'measured',
  max_drawdown_bps: 300,
  max_slippage_bps: 75,
  min_exit_liquidity_usd: 250_000,
  // 6% is exactly what a 3%-in / 3%-out venue costs, so the default sits on the
  // line rather than quietly excluding or quietly waving through the whole meta.
  max_round_trip_bps: 600,
  max_breakeven_days: 60,
  allow_leverage: false,
  approval_mode: 'manual',
  protocol_allowlist: ['morpho', 'the-index', 'quotrons', 'hood10'],
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

/**
 * The terms of a fee-distribution token.
 *
 * Every field here is either read from a contract or left null. There is no
 * "reasonable default" in this record: a guessed fee or an assumed cadence
 * would flow straight into a break-even figure a user might act on.
 */
export type DistributionTerms = {
  token_address: `0x${string}`
  token_symbol: string
  /** Fee paid on the way in, in basis points of the trade. */
  entry_fee_bps: number
  /** Fee paid on the way out. Same hook in practice, so usually identical. */
  exit_fee_bps: number
  /** Seconds between distribution cycles, from the contract. */
  interval_seconds: number | null
  /** Unix seconds of the next scheduled cycle, when the contract exposes it. */
  next_distribution_at: number | null
  /** Total supply of the token, in whole units. */
  total_supply: number | null
  /** Wallets observed receiving in the last measured cycle. */
  holder_count: number | null
  /** What holders are paid in. */
  paid_in: string[]
  /**
   * Whether holding the token alone earns anything.
   *
   * A property of how the venue is built, not of whether PONSAJI managed to
   * measure a cycle — conflating the two would let a slow read render as
   * "this pays nothing", which is a very different claim.
   */
  pays_holders: boolean
  /**
   * Units of `payout_asset` a wallet receives per whole token held, per cycle.
   *
   * Measured from a handful of real payouts rather than from the cycle total:
   * for a pro-rata distribution the total cancels out of the income equation
   * entirely, so one recipient's payout divided by their balance is the whole
   * answer — and reading five logs is far more reliable than reading 3,000.
   */
  payout_per_token: number | null
  /** The leg `payout_per_token` was measured in. */
  payout_asset: string | null
  /** That leg's price, from its own pool. */
  payout_asset_price_usd: number | null
  /** Legs the basket is split across, per the venue's own documentation. */
  leg_count: number
  /** How `payout_per_token` was established, or why it is missing. */
  share_basis: string
  /**
   * Whether sampled recipients all received the same amount per token held.
   * The protocols claim pro-rata; this is PONSAJI checking rather than repeating.
   */
  pro_rata_verified: boolean | null
  /** Recipients sampled, and how many agreed. */
  samples_taken: number
}

export type Opportunity = {
  recipe_id: string
  kind: VenueKind
  name: string
  subtitle: string
  profile: RiskMode
  inputs: { base_asset: string; venue: string; hedge_venue: string | null }
  ingredients: Ingredient[]
  breakdown: CarryBreakdown
  gross_apy: number
  estimated_net_carry: number
  risk_score: number
  exit_liquidity_usd: number
  /** Null for venues that reference no oracle — this meta has none at all. */
  oracle_age_seconds: number | null
  /** The feed publisher's own staleness bound — what "stale" actually means here. */
  oracle_heartbeat_seconds: number | null
  tvl_usd: number | null
  curator: string
  /** The vault for a `vault` row, the token for a `distribution` row. */
  contract_address: `0x${string}`
  /** Present only on `distribution` rows. */
  distribution: DistributionTerms | null
  /** Names the missing source when a row could not be built from live data. */
  unavailable_reason: string | null
  requires_leverage: boolean
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
  | 'base_asset'
  | 'round_trip_cost'
  | 'breakeven_horizon'

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

/* ---------- break-even ---------- */

/**
 * How fast the income stream is assumed to fade.
 *
 * A flat regime is the one assumption the observed data rules out: The Index's
 * own published cycles fell 97% across five hours on 26–27 Aug 2026. Quoting a
 * single break-even number would repeat the mistake the whole product exists to
 * correct, so every figure is stated under three regimes.
 */
export type DecayRegime = 'flat' | 'decay_50_week' | 'decay_90_week'

export const DECAY_REGIMES: { id: DecayRegime; label: string; weeklyRetention: number; note: string }[] = [
  { id: 'flat', label: 'FLAT', weeklyRetention: 1, note: 'Volume holds. Ruled out by the observed cycles; shown as the optimistic bound.' },
  { id: 'decay_50_week', label: '−50% / WEEK', weeklyRetention: 0.5, note: 'Volume halves weekly. A moderate reading of the observed decay.' },
  { id: 'decay_90_week', label: '−90% / WEEK', weeklyRetention: 0.1, note: 'Volume falls ninetenths weekly, near the pace actually observed.' },
]

/** One term of the round-trip cost, with where it came from. */
export type CostTerm = {
  label: string
  usd: number
  bps: number
  source: string
}

export type BreakEven = {
  capital_usd: number
  costs: CostTerm[]
  round_trip_cost_usd: number
  round_trip_bps: number
  /**
   * The position's share of one cycle, measured from the cycle's own logs.
   * Exact and price-free — this is what PONSAJI can prove.
   */
  share_of_cycle: number | null
  cycles_per_day: number | null
  /**
   * Income per day in USD. Null when the distributed basket has no price PONSAJI
   * can source, which on this chain is the normal case.
   */
  daily_income_usd: number | null
  /** Null when income is unpriced, or when the position never repays its cost. */
  days_by_regime: Record<DecayRegime, number | null>
  /** Why a figure is missing, in the user's words. Empty when everything resolved. */
  blocked_by: string | null
  computed_at: number
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

export type PositionStatus = 'active' | 'closed'

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

export type AgentEventKind = 'executed' | 'pending' | 'skipped'

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
