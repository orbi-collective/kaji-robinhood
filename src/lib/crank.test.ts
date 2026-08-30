import { describe, expect, it } from 'vitest'
import { COST_COVERAGE_MULTIPLE, decideCrank, settlementCostUsd } from './crank'
import { CYCLE_MAX_MINUTES, CYCLE_MIN_MINUTES, currentCycle } from './payroll'

/**
 * The crank decides when other people get paid, and when they wait. Both
 * outcomes need to be right, and both need a reason a holder can read.
 */

const T0 = 1_700_000_000_000
const HOUR = 3_600_000
// 0.0348 gwei, the gas price measured on this chain.
const GAS = 34_835_024n
const ETH = 2486.85

describe('settlementCostUsd', () => {
  it('scales with the number of wallets paid', () => {
    const one = settlementCostUsd({ walletCount: 1, gasPriceWei: GAS, ethUsd: ETH })
    const many = settlementCostUsd({ walletCount: 1000, gasPriceWei: GAS, ethUsd: ETH })
    expect(many).toBeGreaterThan(one)
  })

  it('stays affordable at this chain’s gas price', () => {
    // ~3,200 wallets is the size of the field The Index actually pays.
    const cost = settlementCostUsd({ walletCount: 3200, gasPriceWei: GAS, ethUsd: ETH })
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(50)
  })

  it('uses the gas figure measured against the real asset, not a mock', () => {
    // A mock token costs ~25,000 per leg; the real one is a beacon proxy and
    // costs ~37,664. Pinning this stops the cheaper number creeping back in.
    const one = settlementCostUsd({ walletCount: 1, gasPriceWei: 1_000_000_000n, ethUsd: 1000 })
    const two = settlementCostUsd({ walletCount: 2, gasPriceWei: 1_000_000_000n, ethUsd: 1000 })
    const perLeg = ((two - one) / 1000) * 1e18 / 1e9
    expect(Math.round(perLeg)).toBe(37_664)
  })
})

describe('decideCrank', () => {
  const base = {
    launchedAt: T0,
    walletCount: 500,
    gasPriceWei: GAS,
    ethUsd: ETH,
    lastSettledCycle: null as number | null,
  }

  it('waits while the cycle it already settled is still open', () => {
    const now = T0 + 10 * 60_000
    const { index } = currentCycle(T0, now)
    const d = decideCrank({ ...base, now, accountUsd: 10_000, lastSettledCycle: index })
    expect(d.shouldSettle).toBe(false)
    expect(d.reason).toMatch(/still open/i)
  })

  it('settles once a new cycle has closed and the account covers the cost', () => {
    const now = T0 + 4 * HOUR
    const d = decideCrank({ ...base, now, accountUsd: 10_000, lastSettledCycle: 0 })
    expect(d.shouldSettle).toBe(true)
    expect(d.cycleIndex).toBeGreaterThan(0)
  })

  it('rolls a quiet cycle forward rather than burning gas on it', () => {
    const now = T0 + 4 * HOUR
    const cost = settlementCostUsd({ walletCount: 500, gasPriceWei: GAS, ethUsd: ETH })
    const d = decideCrank({ ...base, now, accountUsd: cost * 2, lastSettledCycle: 0 })
    expect(d.shouldSettle).toBe(false)
    expect(d.reason).toMatch(/rolls into the next/i)
    expect(d.requiredUsd).toBeCloseTo(cost * COST_COVERAGE_MULTIPLE, 6)
  })

  it('never settles a run that would pay nobody', () => {
    const d = decideCrank({ ...base, now: T0 + 4 * HOUR, accountUsd: 1e9, walletCount: 0, lastSettledCycle: 0 })
    expect(d.shouldSettle).toBe(false)
    expect(d.reason).toMatch(/nothing to divide/i)
  })

  it('refuses rather than guesses when the cost of a run is unknown', () => {
    const now = T0 + 4 * HOUR
    expect(decideCrank({ ...base, now, accountUsd: null, lastSettledCycle: 0 }).shouldSettle).toBe(false)
    expect(decideCrank({ ...base, now, accountUsd: 10_000, gasPriceWei: null, lastSettledCycle: 0 }).shouldSettle).toBe(
      false,
    )
    expect(decideCrank({ ...base, now, accountUsd: 10_000, ethUsd: null, lastSettledCycle: 0 }).shouldSettle).toBe(false)
  })

  it('gives a reason whichever way it decides', () => {
    const now = T0 + 4 * HOUR
    for (const account of [0, 10, 10_000]) {
      const d = decideCrank({ ...base, now, accountUsd: account, lastSettledCycle: 0 })
      expect(d.reason.length).toBeGreaterThan(10)
    }
  })
})

describe('cadence', () => {
  it('averages roughly an hour, matching the field', () => {
    // The Index settles hourly; this sits with it rather than inventing a pace.
    const runs = 400
    const end = currentCycle(T0, T0 + runs * HOUR)
    const averageMinutes = (runs * 60) / end.index
    expect(averageMinutes).toBeGreaterThan(CYCLE_MIN_MINUTES)
    expect(averageMinutes).toBeLessThan(CYCLE_MAX_MINUTES)
  })

  it('never lands on a schedule a buyer could time', () => {
    // Consecutive closes must not be evenly spaced, or the moment is tradeable.
    const closes: number[] = []
    let now = T0
    for (let i = 0; i < 12; i++) {
      const c = currentCycle(T0, now)
      closes.push(c.closesAt)
      now = c.closesAt + 1
    }
    const gaps = closes.slice(1).map((c, i) => c - closes[i])
    expect(new Set(gaps).size).toBeGreaterThan(6)
  })
})
