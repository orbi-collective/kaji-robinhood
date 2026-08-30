import { currentCycle } from './payroll'

/**
 * The crank — when a payroll run is allowed to settle.
 *
 * Two gates, and both matter for different reasons.
 *
 * **Time.** The seeded cycle must have closed. Cycle lengths are drawn from the
 * launch instant and the cycle index, so the sequence is identical for every
 * viewer and predictable by none. A cron on a fixed published schedule would
 * hand the moment straight back to the wallets the service integral exists to
 * exclude — buy four seconds before a known run, collect, sell. So the cron
 * *checks* often and the run *fires* on the seeded schedule.
 *
 * **Economics.** The account must cover the cost of paying everyone, several
 * times over. HOOD10's documentation puts the reasoning well: a fixed short
 * interval regardless of volume spends a rising share of the dividend on gas as
 * volume falls, which is the opposite of what a holder wants. So a quiet cycle
 * simply rolls into the next one and the account keeps filling.
 *
 * Cadence is matched to the field rather than invented. The Index settles
 * hourly (`interval()` reads 3600); Quotrons gates on a WETH floor with a
 * sixty-second minimum; HOOD10 cranks every three hours behind a cost gate.
 * Averaging an hour with a seeded spread sits inside that range and keeps the
 * moment unpredictable.
 */

/**
 * Gas for a single payout leg.
 *
 * Measured, not assumed: 37,664 per recipient over a 400-wallet batch against
 * the real payout asset on a mainnet fork (`npm run test:fork`). A mock token
 * costs about 25,000 — the difference is the beacon proxy, which routes every
 * transfer through a delegatecall. Taking the mock's number would have
 * understated every settlement estimate by half.
 */
export const GAS_PER_PAYOUT = 37_664

/** Overhead of the settlement transaction itself, plus the approval it needs. */
export const GAS_SETTLEMENT_BASE = 110_000

/**
 * How many times over the account must cover its own settlement.
 *
 * At one times cost a run pays for nothing but its own gas. Requiring a
 * multiple means a run always delivers materially more than it burns.
 */
export const COST_COVERAGE_MULTIPLE = 20

export type CrankDecision = {
  shouldSettle: boolean
  /** Plain-language reason, whichever way it went. */
  reason: string
  cycleIndex: number
  cycleClosesAt: number
  /** What paying everyone would cost right now. */
  settlementCostUsd: number | null
  accountUsd: number | null
  /** Account must clear this before a run is worth making. */
  requiredUsd: number | null
}

/** Cost of settling to `walletCount` wallets at the current gas price. */
export function settlementCostUsd(args: {
  walletCount: number
  gasPriceWei: bigint
  ethUsd: number
}): number {
  const gas = GAS_SETTLEMENT_BASE + GAS_PER_PAYOUT * Math.max(0, args.walletCount)
  return (Number(args.gasPriceWei) * gas * args.ethUsd) / 1e18
}

/**
 * Decides whether this invocation should settle.
 *
 * Pure, so the same decision can be replayed from the same inputs — which is
 * what makes a run auditable after the fact rather than merely announced.
 */
export function decideCrank(args: {
  launchedAt: number
  now: number
  accountUsd: number | null
  walletCount: number
  gasPriceWei: bigint | null
  ethUsd: number | null
  /** Index of the last cycle actually settled, or null before the first run. */
  lastSettledCycle: number | null
}): CrankDecision {
  const { index, closesAt } = currentCycle(args.launchedAt, args.now)

  const base = {
    cycleIndex: index,
    cycleClosesAt: closesAt,
    settlementCostUsd: null as number | null,
    accountUsd: args.accountUsd,
    requiredUsd: null as number | null,
  }

  // The open cycle has not closed yet. Nothing is owed and nothing is due.
  if (args.lastSettledCycle !== null && index <= args.lastSettledCycle) {
    return { ...base, shouldSettle: false, reason: `Cycle ${index} is still open.` }
  }

  if (args.walletCount <= 0) {
    return { ...base, shouldSettle: false, reason: 'No wallet has accrued service, so there is nothing to divide.' }
  }

  if (args.accountUsd === null || args.gasPriceWei === null || args.ethUsd === null) {
    return {
      ...base,
      shouldSettle: false,
      reason: 'The account balance or the gas price could not be read, so the cost of a run is unknown.',
    }
  }

  const cost = settlementCostUsd({
    walletCount: args.walletCount,
    gasPriceWei: args.gasPriceWei,
    ethUsd: args.ethUsd,
  })
  const required = cost * COST_COVERAGE_MULTIPLE

  if (args.accountUsd < required) {
    return {
      ...base,
      shouldSettle: false,
      settlementCostUsd: cost,
      requiredUsd: required,
      reason: `The account holds $${args.accountUsd.toFixed(2)} and paying ${args.walletCount} wallets costs $${cost.toFixed(2)}. A run needs $${required.toFixed(2)} to be worth making, so this cycle rolls into the next.`,
    }
  }

  return {
    ...base,
    shouldSettle: true,
    settlementCostUsd: cost,
    requiredUsd: required,
    reason: `Cycle ${index} closed and the account covers settlement ${(args.accountUsd / cost).toFixed(0)}× over.`,
  }
}
