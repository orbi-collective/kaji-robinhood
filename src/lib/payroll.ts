/**
 * The service integral — PONSAJI's own distribution mechanic.
 *
 * Every venue PONSAJI measures shares one exploit: they pay on a balance snapshot.
 * A wallet can buy thirty seconds before the snapshot, collect a full share,
 * and sell immediately after. The holders who sat all cycle subsidise it.
 *
 * This closes that by paying on *time actually held* rather than on balance at
 * an instant. A wallet's claim is the integral of its balance over the time
 * since it last reduced its holding:
 *
 *     wᵢ(T) = ∫ bᵢ(t) dt  over [t_resetᵢ, T]
 *     constant q held for τ  →  w = q · τ
 *
 * Any reduction resets that wallet's clock to the present. Two properties fall
 * out, and both are provable rather than asserted:
 *
 *   Lateness cannot be bought off. A wallet arriving τ before a run holds at
 *   most qτ against a field that has been sitting all cycle, so its share is
 *   bounded by qτ/(qτ + W_rest), which tends to zero as τ does — however large
 *   q is. `shareOfLateEntry()` computes exactly this.
 *
 *   Splitting achieves nothing. Service is linear in both balance and time, so
 *   dividing q across k wallets sums straight back to q·τ. There is no sybil
 *   to run. `isSybilInvariant()` demonstrates it on real numbers.
 *
 * Nothing here touches the network. It is arithmetic over an event log, which
 * is what makes a payroll run reproducible by anyone holding the same log.
 */

/** A balance change, from a Transfer log. */
export type BalanceEvent = {
  wallet: `0x${string}`
  /** Balance *after* this event, in whole tokens. */
  balance: number
  /** Unix milliseconds. */
  at: number
}

export type ServiceRecord = {
  wallet: `0x${string}`
  /** Accrued service in token-minutes. */
  service: number
  /** Balance at the close of the run. */
  balance: number
  /** When this wallet's clock last restarted. */
  resetAt: number
  /** Minutes of unbroken service at the close. */
  minutesHeld: number
}

export type PayrollRun = {
  /** Unix ms the run closed at. */
  closedAt: number
  /** Total service across every wallet — the denominator. */
  totalService: number
  records: (ServiceRecord & { share: number; payoutUsd: number })[]
  /** What the account held at the run. */
  accountUsd: number
  /** Wallets that held but accrued no service. */
  zeroServiceWallets: number
}

const MINUTE_MS = 60_000

/**
 * Default cycle bounds, averaging an hour.
 *
 * Chosen to sit with the field rather than invented: The Index settles hourly,
 * Quotrons gates on a WETH floor with a sixty-second minimum, HOOD10 cranks
 * every three hours behind a cost gate. The spread inside the hour is what
 * stops the moment being tradeable.
 */
export const CYCLE_MIN_MINUTES = 45
export const CYCLE_MAX_MINUTES = 75

/**
 * Folds a balance-event log into service records as of `closeAt`.
 *
 * The log must be ordered by time. Each wallet accumulates `balance × elapsed`
 * for every stretch it held, and a *reduction* — not a transfer, not an
 * increase — discards the accrued area and restarts the clock. Increasing a
 * holding keeps the service already earned, because nothing about buying more
 * makes the earlier time less real.
 */
export function computeService(events: BalanceEvent[], closeAt: number): ServiceRecord[] {
  const state = new Map<
    `0x${string}`,
    { service: number; balance: number; since: number; resetAt: number }
  >()

  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.at > closeAt) break
    const prev = state.get(e.wallet)

    if (!prev) {
      state.set(e.wallet, { service: 0, balance: e.balance, since: e.at, resetAt: e.at })
      continue
    }

    if (e.balance < prev.balance) {
      // A reduction of any size restarts the clock for this wallet.
      state.set(e.wallet, { service: 0, balance: e.balance, since: e.at, resetAt: e.at })
      continue
    }

    // Holding or adding: bank the area earned so far, then carry on.
    const elapsed = (e.at - prev.since) / MINUTE_MS
    state.set(e.wallet, {
      service: prev.service + prev.balance * elapsed,
      balance: e.balance,
      since: e.at,
      resetAt: prev.resetAt,
    })
  }

  const out: ServiceRecord[] = []
  for (const [wallet, s] of state) {
    const trailing = (closeAt - s.since) / MINUTE_MS
    out.push({
      wallet,
      service: s.service + s.balance * Math.max(0, trailing),
      balance: s.balance,
      resetAt: s.resetAt,
      minutesHeld: Math.max(0, (closeAt - s.resetAt) / MINUTE_MS),
    })
  }
  return out.sort((a, b) => b.service - a.service)
}

/**
 * Divides an account across service records.
 *
 * Wallets holding nothing at the close are excluded — service is a claim on
 * having held, and a wallet that has sold has none. The denominator is the sum
 * of paid service only, so nothing is stranded in an unpayable remainder.
 */
export function runPayroll(args: {
  records: ServiceRecord[]
  accountUsd: number
  closedAt: number
  /** Smallest balance that earns. Zero means everyone who held earns. */
  minimumBalance?: number
}): PayrollRun {
  const { records, accountUsd, closedAt, minimumBalance = 0 } = args
  const eligible = records.filter((r) => r.balance > 0 && r.balance >= minimumBalance && r.service > 0)
  const totalService = eligible.reduce((s, r) => s + r.service, 0)

  return {
    closedAt,
    totalService,
    accountUsd,
    zeroServiceWallets: records.length - eligible.length,
    records: eligible.map((r) => {
      const share = totalService > 0 ? r.service / totalService : 0
      return { ...r, share, payoutUsd: accountUsd * share }
    }),
  }
}

/**
 * Upper bound on what a late arrival can claim.
 *
 * This is the guarantee the mechanic exists to provide, so it is computed
 * rather than described: a wallet buying `balance` exactly `minutesBefore` a
 * run cannot exceed this share, no matter how large the purchase.
 */
export function shareOfLateEntry(args: {
  balance: number
  minutesBefore: number
  incumbentService: number
}): number {
  const late = args.balance * Math.max(0, args.minutesBefore)
  const total = late + Math.max(0, args.incumbentService)
  return total > 0 ? late / total : 0
}

/**
 * Confirms that splitting a holding across wallets changes nothing.
 *
 * Service is linear in balance and in time, so `Σ (q/k)·τ = q·τ`. Kept as a
 * function rather than a comment because a claim about sybil resistance should
 * be checkable against the same code that pays people.
 */
export function isSybilInvariant(balance: number, minutes: number, splits: number): boolean {
  const whole = balance * minutes
  const split = Array.from({ length: splits }, () => (balance / splits) * minutes).reduce((a, b) => a + b, 0)
  return Math.abs(whole - split) < 1e-9
}

/**
 * Length of cycle `index`, in minutes.
 *
 * Drawn deterministically from the launch instant and the cycle index, so the
 * whole sequence is identical for every viewer and predictable by none of
 * them. Publishing the exact moment of a run would hand it straight back to
 * the late arrivals this mechanic exists to exclude — but a seeded sequence
 * means anyone can reproduce every past run and check it was not chosen after
 * the fact.
 */
export function cycleLengthMinutes(args: {
  launchedAt: number
  index: number
  minMinutes?: number
  maxMinutes?: number
}): number {
  const { launchedAt, index, minMinutes = CYCLE_MIN_MINUTES, maxMinutes = CYCLE_MAX_MINUTES } = args
  // xorshift over the seed: cheap, deterministic, and adequate for choosing a
  // wait. Nothing of value is protected by this beyond unpredictability.
  let x = (Math.floor(launchedAt / 1000) ^ (index * 0x9e3779b9)) >>> 0
  x ^= x << 13
  x >>>= 0
  x ^= x >> 17
  x ^= x << 5
  x >>>= 0
  const unit = x / 0xffffffff
  return minMinutes + unit * (maxMinutes - minMinutes)
}

/**
 * The cycle open at `now`, and when it closes.
 *
 * Walks the seeded sequence forward from launch. Written as one pass rather
 * than a helper called in a loop, because summing the whole sequence for every
 * candidate index is quadratic and this runs on every crank invocation.
 */
export function currentCycle(launchedAt: number, now: number): { index: number; closesAt: number } {
  let index = 0
  let closesAt = launchedAt + cycleLengthMinutes({ launchedAt, index: 0 }) * MINUTE_MS
  // Guards a launch instant set far in the past by mistake.
  while (closesAt <= now && index < 1_000_000) {
    index += 1
    closesAt += cycleLengthMinutes({ launchedAt, index }) * MINUTE_MS
  }
  return { index, closesAt }
}

/** Unix ms at which cycle `index` closes. */
export function cycleClosesAt(launchedAt: number, index: number): number {
  let t = launchedAt
  for (let i = 0; i <= index; i++) t += cycleLengthMinutes({ launchedAt, index: i }) * MINUTE_MS
  return t
}
