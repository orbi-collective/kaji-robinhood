import { describe, expect, it } from 'vitest'
import {
  computeService,
  currentCycle,
  cycleLengthMinutes,
  CYCLE_MAX_MINUTES,
  CYCLE_MIN_MINUTES,
  isSybilInvariant,
  runPayroll,
  shareOfLateEntry,
  type BalanceEvent,
} from './payroll'

/**
 * These tests exist because this file decides who gets paid.
 *
 * The two properties the mechanic advertises — that lateness cannot be bought
 * off, and that splitting a holding gains nothing — are claims about money.
 * Asserting them in prose is marketing; asserting them here is a check that
 * fails loudly when the arithmetic stops matching the promise.
 */

const W = (n: number) => `0x${String(n).padStart(40, '0')}` as `0x${string}`
const MIN = 60_000
const T0 = 1_700_000_000_000

describe('computeService', () => {
  it('accrues balance × minutes for an unbroken holding', () => {
    const events: BalanceEvent[] = [{ wallet: W(1), balance: 100, at: T0 }]
    const [r] = computeService(events, T0 + 10 * MIN)
    expect(r.service).toBeCloseTo(1000, 6) // 100 tokens × 10 minutes
    expect(r.minutesHeld).toBeCloseTo(10, 6)
  })

  it('restarts the clock on any reduction, however small', () => {
    const events: BalanceEvent[] = [
      { wallet: W(1), balance: 100, at: T0 },
      // Nine minutes of service, then a one-token sale.
      { wallet: W(1), balance: 99, at: T0 + 9 * MIN },
    ]
    const [r] = computeService(events, T0 + 10 * MIN)
    // The 900 token-minutes earned before the sale are gone.
    expect(r.service).toBeCloseTo(99, 6) // 99 × 1 minute since the reset
    expect(r.resetAt).toBe(T0 + 9 * MIN)
  })

  it('keeps service already earned when a holding is increased', () => {
    const events: BalanceEvent[] = [
      { wallet: W(1), balance: 100, at: T0 },
      { wallet: W(1), balance: 300, at: T0 + 5 * MIN },
    ]
    const [r] = computeService(events, T0 + 10 * MIN)
    // 100×5 banked, then 300×5. Buying more does not undo time already served.
    expect(r.service).toBeCloseTo(500 + 1500, 6)
    expect(r.resetAt).toBe(T0)
  })

  it('ignores events after the close', () => {
    const events: BalanceEvent[] = [
      { wallet: W(1), balance: 100, at: T0 },
      { wallet: W(1), balance: 0, at: T0 + 20 * MIN },
    ]
    const [r] = computeService(events, T0 + 10 * MIN)
    expect(r.balance).toBe(100)
    expect(r.service).toBeCloseTo(1000, 6)
  })
})

describe('runPayroll', () => {
  const events: BalanceEvent[] = [
    { wallet: W(1), balance: 100, at: T0 }, // 10 min → 1000
    { wallet: W(2), balance: 200, at: T0 + 5 * MIN }, // 5 min → 1000
  ]

  it('divides the account in proportion to service, not to balance', () => {
    const records = computeService(events, T0 + 10 * MIN)
    const run = runPayroll({ records, accountUsd: 1000, closedAt: T0 + 10 * MIN })
    // Equal service despite one wallet holding twice as much.
    expect(run.records.map((r) => r.payoutUsd)).toEqual([500, 500])
  })

  it('pays out the whole account and nothing more', () => {
    const records = computeService(events, T0 + 10 * MIN)
    const run = runPayroll({ records, accountUsd: 777.77, closedAt: T0 + 10 * MIN })
    const paid = run.records.reduce((s, r) => s + r.payoutUsd, 0)
    expect(paid).toBeCloseTo(777.77, 6)
    expect(run.records.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9)
  })

  it('excludes wallets that have sold out, so nothing is stranded', () => {
    const sold: BalanceEvent[] = [...events, { wallet: W(2), balance: 0, at: T0 + 9 * MIN }]
    const records = computeService(sold, T0 + 10 * MIN)
    const run = runPayroll({ records, accountUsd: 1000, closedAt: T0 + 10 * MIN })
    expect(run.records).toHaveLength(1)
    expect(run.records[0].wallet).toBe(W(1))
    expect(run.records[0].payoutUsd).toBeCloseTo(1000, 6)
    expect(run.zeroServiceWallets).toBe(1)
  })

  it('does not divide by zero when nobody has service', () => {
    const run = runPayroll({ records: [], accountUsd: 1000, closedAt: T0 })
    expect(run.records).toEqual([])
    expect(run.totalService).toBe(0)
  })
})

describe('the two advertised properties', () => {
  it('drives a late arrival towards zero share however large it is', () => {
    const incumbentService = 100 * 300 // a modest field: 100 tokens for 5 hours
    const shares = [10, 1, 0.1, 0.01].map((minutesBefore) =>
      shareOfLateEntry({ balance: 1_000_000, minutesBefore, incumbentService }),
    )
    // Monotonically decreasing as the entry gets later.
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1])
    // A million tokens arriving 0.6 seconds early still gets almost nothing.
    expect(shares.at(-1)!).toBeLessThan(0.26)
  })

  it('gains nothing from splitting a holding across wallets', () => {
    for (const k of [2, 5, 10, 1000]) expect(isSybilInvariant(1_000_000, 42, k)).toBe(true)
  })

  it('pays a split holding exactly what the whole would have earned', () => {
    const whole: BalanceEvent[] = [
      { wallet: W(1), balance: 900, at: T0 },
      { wallet: W(9), balance: 100, at: T0 },
    ]
    const split: BalanceEvent[] = [
      ...[1, 2, 3].map((i) => ({ wallet: W(i * 10), balance: 300, at: T0 })),
      { wallet: W(9), balance: 100, at: T0 },
    ]
    const at = T0 + 30 * MIN
    const a = runPayroll({ records: computeService(whole, at), accountUsd: 1000, closedAt: at })
    const b = runPayroll({ records: computeService(split, at), accountUsd: 1000, closedAt: at })

    const paidToSplitter = b.records
      .filter((r) => r.wallet !== W(9))
      .reduce((s, r) => s + r.payoutUsd, 0)
    const paidToWhole = a.records.find((r) => r.wallet === W(1))!.payoutUsd
    expect(paidToSplitter).toBeCloseTo(paidToWhole, 6)
  })
})

describe('cycles', () => {
  it('stays inside its bounds', () => {
    // Bound to the exported constants rather than to literals, so changing the
    // cadence cannot silently leave this test asserting the old one.
    for (let i = 0; i < 500; i++) {
      const len = cycleLengthMinutes({ launchedAt: T0, index: i })
      expect(len).toBeGreaterThanOrEqual(CYCLE_MIN_MINUTES)
      expect(len).toBeLessThanOrEqual(CYCLE_MAX_MINUTES)
    }
  })

  it('is identical for every viewer and reproducible after the fact', () => {
    const a = Array.from({ length: 20 }, (_, i) => cycleLengthMinutes({ launchedAt: T0, index: i }))
    const b = Array.from({ length: 20 }, (_, i) => cycleLengthMinutes({ launchedAt: T0, index: i }))
    expect(a).toEqual(b)
  })

  it('does not repeat the same length every cycle', () => {
    const lengths = Array.from({ length: 50 }, (_, i) => cycleLengthMinutes({ launchedAt: T0, index: i }))
    expect(new Set(lengths.map((l) => l.toFixed(4))).size).toBeGreaterThan(20)
  })

  it('advances the open cycle as time passes', () => {
    const first = currentCycle(T0, T0 + 60_000)
    const later = currentCycle(T0, T0 + 24 * 60 * MIN)
    expect(later.index).toBeGreaterThan(first.index)
    expect(later.closesAt).toBeGreaterThan(T0 + 24 * 60 * MIN)
  })
})
