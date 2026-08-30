import { DECAY_REGIMES, type BreakEven, type CostTerm, type DecayRegime, type Opportunity } from './types'

/**
 * Break-even model for fee-distribution positions.
 *
 * The question this answers is the one neither venue in this meta puts on
 * screen: a position pays a fee to enter and a fee to leave, and earns a share
 * of somebody else's trading volume. How long must the capital sit before the
 * income has repaid the round trip?
 *
 * Two rules govern everything below.
 *
 * 1. A term is measured or it is null. There is no default fee, no assumed
 *    cadence, no stand-in price. A break-even figure is something a user may
 *    act on with real money, so a guessed input is worse than no answer.
 *
 * 2. No single answer. Income here is a share of trading volume, and volume
 *    decays — The Index's own published cycles fell 97% across five hours on
 *    26-27 Aug 2026. Quoting one number would repeat the error the product
 *    exists to correct, so every figure is stated under three regimes.
 */

/** Chainlink-priced gas assumption for one entry and one exit. */
const ROUND_TRIP_ACTIONS = 2

export type BreakEvenInput = {
  capital_usd: number
  /**
   * USD one whole token earns per cycle, measured from a live cycle's payouts
   * and priced against the payout asset's own pool. Null leaves the model
   * honestly unresolved rather than filled with a plausible number.
   */
  per_token_usd: number | null
  /** Gas for one action, in USD, read from the chain. Null when unreadable. */
  gas_per_action_usd: number | null
  /** Where that gas figure came from. */
  gas_basis: string
}

export const DEFAULT_BREAKEVEN_INPUT: Omit<BreakEvenInput, 'capital_usd'> = {
  per_token_usd: null,
  gas_per_action_usd: null,
  gas_basis: 'not read',
}

/**
 * Days for cumulative income to repay `cost`, when each week retains
 * `retention` of the previous week's rate.
 *
 * With daily rate `d` decaying by factor `r` per week, day `n` earns
 * `d · r^(n/7)`. Integrating and solving for the day the total crosses `cost`
 * gives the closed form below. When the decaying series converges to a total
 * beneath the cost, the position never repays and the answer is null rather
 * than a large number that looks like a long wait.
 */
function daysToRecover(cost: number, dailyIncome: number, retention: number): number | null {
  if (dailyIncome <= 0 || cost <= 0) return null
  if (retention >= 1) return cost / dailyIncome

  // k = ln(retention)/7, the continuous daily decay constant (negative).
  const k = Math.log(retention) / 7
  // Total income over all time converges to dailyIncome / -k.
  const lifetimeTotal = dailyIncome / -k
  if (lifetimeTotal <= cost) return null

  // cost = (dailyIncome/k)·(e^(k·n) − 1)  →  n = ln(1 + cost·k/dailyIncome)/k
  const n = Math.log(1 + (cost * k) / dailyIncome) / k
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Itemises what a round trip costs, each term naming where it came from. */
export function roundTripCosts(opportunity: Opportunity, input: BreakEvenInput): CostTerm[] {
  const terms: CostTerm[] = []
  const capital = input.capital_usd
  const d = opportunity.distribution

  if (d) {
    const entryUsd = (capital * d.entry_fee_bps) / 10_000
    terms.push({
      label: 'Entry fee',
      usd: entryUsd,
      bps: d.entry_fee_bps,
      source: `${opportunity.curator} fee hook, read onchain`,
    })

    // The exit is priced on the way out, so it is charged on what the position
    // is worth then. Charging it on entry capital understates the round trip
    // whenever the position appreciates, so entry capital is the floor, not the
    // estimate — stated plainly rather than modelled with an invented return.
    const exitUsd = (capital * d.exit_fee_bps) / 10_000
    terms.push({
      label: 'Exit fee',
      usd: exitUsd,
      bps: d.exit_fee_bps,
      source: 'Same hook on the way out, charged on exit value',
    })
  }

  const slippage = opportunity.breakdown.estimated_slippage
  if (slippage > 0) {
    terms.push({
      label: 'Price impact',
      usd: capital * slippage * ROUND_TRIP_ACTIONS,
      bps: Math.round(slippage * 10_000 * ROUND_TRIP_ACTIONS),
      source: 'Quoted against live pool depth, both legs',
    })
  }

  // Omitted rather than guessed when the chain would not say.
  if (input.gas_per_action_usd !== null) {
    const gas = input.gas_per_action_usd * ROUND_TRIP_ACTIONS
    terms.push({
      label: 'Gas',
      usd: gas,
      bps: capital > 0 ? Math.round((gas / capital) * 10_000) : 0,
      source: `Entry and exit · ${input.gas_basis}`,
    })
  }

  return terms
}

export function computeBreakEven(opportunity: Opportunity, input: BreakEvenInput): BreakEven {
  const costs = roundTripCosts(opportunity, input)
  const roundTripUsd = costs.reduce((s, c) => s + c.usd, 0)
  const roundTripBps = input.capital_usd > 0 ? Math.round((roundTripUsd / input.capital_usd) * 10_000) : 0

  const empty: Record<DecayRegime, number | null> = { flat: null, decay_50_week: null, decay_90_week: null }
  const d = opportunity.distribution

  const base: BreakEven = {
    capital_usd: input.capital_usd,
    costs,
    round_trip_cost_usd: roundTripUsd,
    round_trip_bps: roundTripBps,
    share_of_cycle: null,
    cycles_per_day: null,
    daily_income_usd: null,
    days_by_regime: empty,
    blocked_by: null,
    computed_at: Date.now(),
  }

  if (!d) {
    return { ...base, blocked_by: 'This is a vault position — it has no entry fee to repay.' }
  }

  const tokens = tokensHeld(opportunity, input.capital_usd)
  const cyclesPerDay = d.interval_seconds && d.interval_seconds > 0 ? 86_400 / d.interval_seconds : null

  // Share of a cycle is reported for its own sake — it is the exact,
  // price-free fact about this position, and it holds even when pricing fails.
  const share =
    d.payout_per_token !== null && tokens > 0 && d.total_supply && d.total_supply > 0
      ? tokens / d.total_supply
      : null

  if (!d.pays_holders) {
    return { ...base, cycles_per_day: cyclesPerDay, blocked_by: d.share_basis }
  }

  if (d.payout_per_token === null || tokens <= 0) {
    return {
      ...base,
      cycles_per_day: cyclesPerDay,
      blocked_by:
        tokens <= 0
          ? 'This token has no readable price, so the number of tokens this capital buys is unknown.'
          : `No live payout could be measured, so what one token earns is unknown. ${d.share_basis}`,
    }
  }

  if (input.per_token_usd === null) {
    return {
      ...base,
      share_of_cycle: share,
      cycles_per_day: cyclesPerDay,
      blocked_by: `The payout was measured but could not be priced, so income per day is unknown. ${d.share_basis}`,
    }
  }

  if (cyclesPerDay === null) {
    return {
      ...base,
      share_of_cycle: share,
      blocked_by: 'The distribution contract did not report a cycle interval, so income per day cannot be derived.',
    }
  }

  const dailyIncome = input.per_token_usd * tokens * cyclesPerDay
  const days = Object.fromEntries(
    DECAY_REGIMES.map((r) => [r.id, daysToRecover(roundTripUsd, dailyIncome, r.weeklyRetention)]),
  ) as Record<DecayRegime, number | null>

  return {
    ...base,
    share_of_cycle: share,
    cycles_per_day: cyclesPerDay,
    daily_income_usd: dailyIncome,
    days_by_regime: days,
  }
}

/**
 * Tokens a given amount of capital buys, after the entry fee is taken.
 *
 * The fee is charged on the trade, so the capital that actually reaches the
 * position is smaller than the capital committed — counting the full amount
 * would overstate the holding and understate break-even.
 */
function tokensHeld(opportunity: Opportunity, capitalUsd: number): number {
  const d = opportunity.distribution
  if (!d || !d.total_supply || d.total_supply <= 0) return 0
  const net = capitalUsd * (1 - d.entry_fee_bps / 10_000)
  const priceUsd = opportunity.tvl_usd && opportunity.tvl_usd > 0 ? opportunity.tvl_usd / d.total_supply : null
  return priceUsd && priceUsd > 0 ? net / priceUsd : 0
}

/** Formats a day count for display, or says why there is nothing to format. */
export function formatDays(days: number | null): string {
  if (days === null) return 'NEVER'
  if (days < 1) return `${Math.round(days * 24)}h`
  if (days < 100) return `${days.toFixed(1)}d`
  if (days < 3650) return `${Math.round(days)}d`
  return `${(days / 365).toFixed(0)}y`
}
