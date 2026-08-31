import { formatUnits, parseAbi, parseAbiItem } from 'viem'
import { publicClient } from './client'
import { computeService, currentCycle, runPayroll, type BalanceEvent, type PayrollRun } from './payroll'
import { TOKENS } from './chain'
import { NATIVE_ETH, POOL_MANAGER } from './venues'
import {
  COMMON_POOL_CANDIDATES,
  exitDepth,
  priceFromSlot0,
  readPoolStateById,
  readSlot0,
  type PoolKey,
} from './uniswapV4'

/**
 * PONSAJI's own token.
 *
 * The mechanic is the service integral in `payroll.ts`: holders are paid in
 * proportion to time actually held, and reducing a holding restarts the clock.
 * The account being divided is the launchpad's creator-fee stream, so there is
 * no treasury, no emission and no revenue story — trading is the whole economy,
 * and that is stated rather than dressed up.
 *
 * Everything here is inert until `TOKEN_ADDRESS` is set. That is deliberate:
 * the token is deployed by hand on the launchpad, and the moment its address
 * exists, filling it in below is the only change required. The pool is then
 * discovered from the chain rather than configured, and the launch instant is
 * read from the pool's own Initialize block so the cycle seed cannot be chosen
 * after the fact.
 */

/* ------------------------------------------------------------------ */
/* Configuration — the only block that changes on launch day           */
/* ------------------------------------------------------------------ */

/**
 * Environment overrides.
 *
 * Launch day is a bad time to discover the crank does not work, so the three
 * addresses can be supplied from the environment as well as edited in below.
 * That makes a full rehearsal possible against a fork before anything real is
 * deployed, and it is how `npm run rehearse` drives this module.
 */
const envOverride = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const addr = (v: string | undefined) => (v && /^0x[a-fA-F0-9]{40}$/.test(v) ? (v as `0x${string}`) : null)

export const PONSAJI_TOKEN = {
  /** Paste the contract address here after deploying. Null keeps the app in pre-launch. */
  address: addr(envOverride.PONSAJI_TOKEN_ADDRESS) as `0x${string}` | null,
  symbol: 'PONSAJI',
  decimals: 18,

  /**
   * The wallet the launchpad pays creator fees into, and the wallet payroll is
   * paid out of. It is published so anyone can watch it fill and empty.
   */
  payrollAccount: addr(envOverride.PONSAJI_PAYROLL_ACCOUNT) as `0x${string}` | null,

  /**
   * What holders are paid in.
   *
   * The token is paired against this on the launchpad, so creator fees arrive
   * already denominated in it and payroll never has to swap — no slippage, no
   * routing, nothing between the fee and the holder.
   *
   * Liquidity was checked first, because paying people in something they cannot
   * sell is its own dishonesty. Measured by what the Uniswap v4 PoolManager
   * actually holds of each candidate: SPY $2.45M, NVDA $1.86M, SPCX $1.46M,
   * TSLA $319K, QQQ $223K, GME $165K, RDDT $151K. SPCX sits comfortably inside
   * the tradable set.
   *
   * A caution worth keeping, because this was got wrong once: an earlier survey
   * guessed pool keys and reported SPCX at $2K, nearly disqualifying it. Its
   * liquidity is in Pons-hook pools at a dynamic fee tier, paired against other
   * stocks — nowhere the guess looked. A key that finds nothing means the guess
   * was wrong, not that nothing is there. Use `npm run survey:payout`, which
   * discovers pools from Initialize events instead.
   *
   * Given several viable options, the choice is narrative, and SPCX is the one
   * that belongs to this machine: precision-engineered hardware that either
   * holds spec or aborts, which is the vocabulary the whole product speaks. It
   * is also genuinely uncommon — five Pons pairs against NVDA's 176, and an
   * asset with no ordinary market to buy it on at all.
   */
  payoutAsset: {
    symbol: envOverride.PONSAJI_PAYOUT_SYMBOL ?? 'SPCX',
    // Overridable so the settlement path can be rehearsed end to end against a
    // throwaway token, and so a different pairing on launch day is a config
    // change rather than a code change.
    address: (addr(envOverride.PONSAJI_PAYOUT_ADDRESS) ??
      '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa') as `0x${string}`,
    decimals: 18,
  },

  /**
   * Unix ms of launch. Left null, it is read from the pool's Initialize block,
   * which is the honest source — a hand-set launch instant is a seed someone
   * could have chosen after seeing the cycle sequence it produces.
   */
  launchedAt: null as number | null,

  /**
   * Cycle bounds, in minutes. The exact length of each is seeded, not published.
   *
   * Averaging an hour matches the field: The Index settles hourly, Quotrons on
   * a WETH floor with a sixty-second minimum, HOOD10 on a three-hour crank
   * behind a cost gate. The spread is what keeps the moment untradeable.
   */
  cycleMinMinutes: 45,
  cycleMaxMinutes: 75,

  /** Smallest balance that earns. Zero means anyone who holds, earns. */
  minimumBalance: 0,

  /**
   * PonsajiPayroll, the batch sender. Paste the address after deploying it.
   *
   * Without it the crank falls back to one transaction per holder, which works
   * but costs a transaction each. The transfer itself is ~37,664 gas per
   * recipient either way (measured on a fork against the real SPCX token, which
   * is a beacon proxy; a plain mock costs ~25,000), so the saving is in time and
   * nonce churn rather than fees. Left null until deployed, because a wrong
   * address here would send an approval to a contract nobody has looked at.
   */
  payrollContract: addr(envOverride.PONSAJI_PAYROLL_CONTRACT) as `0x${string}` | null,

  /**
   * Recipients per batch.
   *
   * Cost is flat per recipient up to at least 500, and this chain's block gas
   * limit is effectively unbounded, so the ceiling is practical rather than
   * technical: a failed batch wastes only its own gas, and smaller batches make
   * a bad recipient quicker to isolate. A full 400-recipient batch of real SPCX
   * measured 15,065,686 gas on a fork.
   */
  batchSize: 400,
} as const

/** True once the token exists and the app can leave pre-launch. */
export function isLaunched(): boolean {
  return PONSAJI_TOKEN.address !== null
}

/* ------------------------------------------------------------------ */
/* Chain reads                                                         */
/* ------------------------------------------------------------------ */

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const erc20BalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

type TransferLog = Awaited<ReturnType<typeof publicClient.getLogs<typeof TRANSFER>>>[number]

const INITIALIZE = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
)

/** ~0.101s per block on this chain. */
const SECONDS_PER_BLOCK = 0.101

export type TokenMarket = {
  poolId: `0x${string}`
  key: { fee: number; tickSpacing: number; hooks: `0x${string}`; quote: `0x${string}` }
  priceUsd: number | null
  /** Quote obtainable before a 5% fall — depth, not market value. */
  exitDepthUsd: number | null
  launchedAt: number
  feeBps: number
}

/**
 * Finds the token's own pool from the chain.
 *
 * Scanning Initialize events beats configuring a pool key by hand: it survives
 * the launchpad choosing a different fee tier than expected, and it yields the
 * launch block as a side effect. Where several pools exist for the token — and
 * on this chain look-alike and decoy pools are common — the one holding
 * liquidity is the real market, so that is the one chosen.
 */
export async function discoverMarket(ethUsd: number | null, signal?: AbortSignal): Promise<TokenMarket | null> {
  const token = PONSAJI_TOKEN.address
  if (!token) return null

  try {
    const head = await publicClient.getBlockNumber()
    const from = head > 2_000_000n ? head - 2_000_000n : 0n

    const logs = [
      ...(await publicClient.getLogs({ address: POOL_MANAGER, event: INITIALIZE, args: { currency0: token }, fromBlock: from, toBlock: head })),
      ...(await publicClient.getLogs({ address: POOL_MANAGER, event: INITIALIZE, args: { currency1: token }, fromBlock: from, toBlock: head })),
    ]
    if (signal?.aborted || logs.length === 0) return null

    /**
     * Deepest pool wins — but only among pools paired against the payout asset.
     *
     * Picking purely by depth follows whichever market happens to be biggest,
     * and on this chain that can be a pool against something else entirely, or
     * a decoy: HOOD10 has five pools and four are empty or junk. Preferring the
     * pair we actually launched against means a deeper unrelated pool cannot
     * quietly redefine what this token's market is.
     */
    const payout = PONSAJI_TOKEN.payoutAsset.address.toLowerCase()
    const pairedWithPayout = logs.filter((l) => {
      const c0 = (l.args.currency0 as string).toLowerCase()
      const c1 = (l.args.currency1 as string).toLowerCase()
      return c0 === payout || c1 === payout
    })
    const candidates = pairedWithPayout.length > 0 ? pairedWithPayout : logs

    let best: { log: (typeof logs)[number]; liquidity: bigint; sqrtPriceX96: bigint } | null = null
    for (const log of candidates) {
      const state = await readPoolStateById(POOL_MANAGER, log.args.id as `0x${string}`)
      if (!state) continue
      if (!best || state.liquidity > best.liquidity) {
        best = { log, liquidity: state.liquidity, sqrtPriceX96: state.sqrtPriceX96 }
      }
    }
    if (!best || best.liquidity === 0n) return null

    const quote =
      (best.log.args.currency0 as string).toLowerCase() === token.toLowerCase()
        ? (best.log.args.currency1 as `0x${string}`)
        : (best.log.args.currency0 as `0x${string}`)

    const block = await publicClient.getBlock({ blockNumber: best.log.blockNumber! })
    const launchedAt = PONSAJI_TOKEN.launchedAt ?? Number(block.timestamp) * 1000

    const key: PoolKey = {
      currencyA: quote,
      currencyB: token,
      fee: Number(best.log.args.fee),
      tickSpacing: Number(best.log.args.tickSpacing),
      hooks: best.log.args.hooks as `0x${string}`,
    }

    const inQuote = priceFromSlot0({
      slot0: { sqrtPriceX96: best.sqrtPriceX96, tick: 0, initialised: true },
      baseToken: token,
      baseDecimals: PONSAJI_TOKEN.decimals,
      quoteToken: quote,
      quoteDecimals: 18,
    })

    const depthQuote = exitDepth({
      liquidity: best.liquidity,
      sqrtPriceX96: best.sqrtPriceX96,
      impact: 0.05,
      quoteDecimals: 18,
    })

    // Only an ETH-quoted pool converts to USD with the feed we hold.
    const quoteIsEth = quote.toLowerCase() === NATIVE_ETH.toLowerCase()
    return {
      poolId: best.log.args.id as `0x${string}`,
      key: { fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks, quote },
      priceUsd: quoteIsEth && ethUsd && inQuote !== null ? inQuote * ethUsd : null,
      exitDepthUsd: quoteIsEth && ethUsd && depthQuote !== null ? depthQuote * ethUsd : null,
      launchedAt,
      // v4 states fees in hundredths of a bip.
      feeBps: Math.round(Number(best.log.args.fee) / 100),
    }
  } catch {
    return null
  }
}

/**
 * How many event-carrying blocks are worth timestamping exactly. Beyond this,
 * one `getBlock` each is thousands of round trips against an endpoint that
 * rate-limits, so anchors are laid instead.
 *
 * Set high deliberately. Exactness is what makes a run reproducible by someone
 * who does not trust it, and a busy hour on the chain's heaviest token touched
 * 545 blocks — so a real cycle should land here, not in the estimate. The
 * crank runs every few hours; a few extra seconds is not a cost worth saving.
 */
const EXACT_BLOCK_BUDGET = 2_500

/** Anchors spread across the span when exact measurement is too expensive. */
const ANCHOR_BUDGET = 192

/** A segment this much slower than the typical one is stalled, and gets split. */
const STALL_FACTOR = 4

/** Concurrent `getBlock` calls. Enough to be quick, few enough to stay polite. */
const BLOCK_CONCURRENCY = 8

/**
 * Maps block numbers to wall-clock times.
 *
 * Service is an integral of balance over time, so a wrong timestamp is a wrong
 * payout — it moves money between wallets, and it does so silently. This used
 * to interpolate between two anchors on the assumption that blocks arrive every
 * 0.101s. That holds while the chain is healthy and fails exactly when it is
 * not: a stall between the anchors tilts the whole line, and every event in the
 * span is misplaced. A rehearsal on uneven blocks showed sixteen minutes of
 * error, which is more than enough to reorder who is owed what.
 *
 * So: measure when measuring is affordable, which on launch day and any quiet
 * cycle it is. When it is not, lay many anchors rather than two, then split any
 * segment that looks stalled — an outage distorts one segment instead of all of
 * them. `exact` is recorded in the run so a reader knows which they are holding.
 */
async function timestampIndex(
  eventBlocks: bigint[],
  fromBlock: bigint,
  toBlock: bigint,
  signal?: AbortSignal,
): Promise<((bn: bigint) => number) & { exact: boolean }> {
  const known = new Map<bigint, number>()

  const measure = async (blocks: bigint[]) => {
    const pending = blocks.filter((b) => !known.has(b))
    for (let i = 0; i < pending.length; i += BLOCK_CONCURRENCY) {
      if (signal?.aborted) return
      const slice = pending.slice(i, i + BLOCK_CONCURRENCY)
      const got = await Promise.all(slice.map((b) => publicClient.getBlock({ blockNumber: b })))
      got.forEach((block, j) => known.set(slice[j], Number(block.timestamp) * 1000))
    }
  }

  // The cheap, exact case: ask about precisely the blocks that matter.
  if (eventBlocks.length <= EXACT_BLOCK_BUDGET) {
    await measure(eventBlocks)
    const timeOf = (bn: bigint) => known.get(bn) ?? 0
    return Object.assign(timeOf, { exact: true })
  }

  // Otherwise lay anchors across the span and interpolate between neighbours.
  const span = toBlock - fromBlock
  const stride = span / BigInt(ANCHOR_BUDGET) || 1n
  const anchors: bigint[] = []
  for (let b = fromBlock; b < toBlock; b += stride) anchors.push(b)
  anchors.push(toBlock)
  await measure(anchors)

  // Split whatever looks like a stall, so one outage cannot tilt the whole line.
  const rate = (a: bigint, b: bigint) => (known.get(b)! - known.get(a)!) / Number(b - a || 1n)
  const rates = anchors.slice(1).map((b, i) => rate(anchors[i], b))
  const typical = [...rates].sort((x, y) => x - y)[Math.floor(rates.length / 2)] || 1
  const extra: bigint[] = []
  rates.forEach((r, i) => {
    if (r <= typical * STALL_FACTOR) return
    const lo = anchors[i]
    const step = (anchors[i + 1] - lo) / 8n || 1n
    for (let b = lo + step; b < anchors[i + 1]; b += step) extra.push(b)
  })
  await measure(extra)

  const grid = [...known.keys()].sort((a, b) => Number(a - b))
  const timeOf = (bn: bigint) => {
    const hit = known.get(bn)
    if (hit !== undefined) return hit
    // Binary search for the bracketing anchors, then a straight line between them.
    let lo = 0
    let hi = grid.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (grid[mid] <= bn) lo = mid
      else hi = mid
    }
    const a = grid[lo]
    const b = grid[hi]
    const at = known.get(a)!
    const bt = known.get(b)!
    return at + ((bt - at) * Number(bn - a)) / (Number(b - a) || 1)
  }
  return Object.assign(timeOf, { exact: false })
}

/**
 * Rebuilds every wallet's balance history from Transfer logs.
 *
 * The service integral needs balances over time, and the chain only records
 * changes, so the log is replayed into running balances. This is the ledger a
 * payroll run divides, and publishing it is what lets anyone reproduce a run
 * instead of trusting it.
 *
 * Two things this endpoint forces. Log queries must be **chunked** — it serves
 * history three days deep but times out on wide windows, so asking for a
 * cycle's worth in one call fails outright. And block timestamps must be
 * **interpolated** rather than fetched: a busy cycle touches thousands of
 * blocks, and one `getBlock` each would be thousands of round trips against an
 * endpoint that rate-limits. Two anchors and a straight line between them is
 * exact at both ends and well inside a second in the middle, which is far finer
 * than a service integral measured in minutes needs.
 */

/**
 * Starting window for a log scan, and the floor a split will not go below.
 *
 * The endpoint's real limit is **10,000 matched logs**, not a block width, so a
 * fixed chunk size cannot be correct: the same window is fine on a quiet hour
 * and refused on a busy one. The scan starts wide and halves on refusal, which
 * adapts to whatever the traffic actually was.
 */
const LOG_WINDOW_START = 20_000n
const LOG_WINDOW_FLOOR = 250n

/**
 * Reads Transfer logs across a range, adapting to whichever way the endpoint
 * refuses.
 *
 * Two refusals mean opposite things and must not be treated alike:
 *
 *   "exceeds limit of 10000" — the window matched too much. Halve it.
 *   rate limit, timeout      — the window was fine, the pace was not. Wait and
 *                              retry the *same* window; halving here would
 *                              shrink towards the floor and fail everything.
 *
 * Conflating them is what makes a scan collapse: every call fails, the window
 * halves each time, and a perfectly readable range reports itself unreadable.
 *
 * Returns null rather than a partial list. A hole in the ledger silently
 * understates somebody's service, so a scan that cannot complete is reported as
 * a failure and never quietly paid out on.
 */
const LOG_PACE_MS = 250
const LOG_MAX_RETRIES = 8

function isTooManyLogs(e: unknown): boolean {
  return /exceeds limit|too many results|query returned more than/i.test(String((e as Error)?.message ?? ''))
}

async function scanTransfers(
  token: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  signal?: AbortSignal,
  args?: { from?: `0x${string}`; to?: `0x${string}` },
): Promise<TransferLog[] | null> {
  const out: TransferLog[] = []
  let window = LOG_WINDOW_START
  let cursor = fromBlock
  let retries = 0

  while (cursor <= toBlock) {
    if (signal?.aborted) return null
    const end = cursor + window - 1n > toBlock ? toBlock : cursor + window - 1n

    try {
      out.push(
        ...(await publicClient.getLogs({ address: token, event: TRANSFER, args, fromBlock: cursor, toBlock: end })),
      )
      cursor = end + 1n
      retries = 0
      // Grow back slowly. Doubling after a success immediately re-inflates to a
      // size the traffic already refused, throwing away a call every time —
      // measured on a token running eleven transfers a block, that was most of
      // the requests in the scan.
      if (window < LOG_WINDOW_START) window = (window * 3n) / 2n
      await new Promise((r) => setTimeout(r, LOG_PACE_MS))
    } catch (e) {
      if (isTooManyLogs(e)) {
        if (window <= LOG_WINDOW_FLOOR) return null
        window /= 2n
        continue
      }
      // Anything else is the endpoint asking for patience, not a smaller range.
      if (retries >= LOG_MAX_RETRIES) return null
      retries += 1
      await new Promise((r) => setTimeout(r, LOG_PACE_MS * 4 * retries))
    }
  }
  return out
}

/**
 * Rebuilds every wallet's balance history from Transfer logs.
 *
 * The service integral needs balances over time, and the chain only records
 * changes, so the log is replayed into running balances. This is the ledger a
 * payroll run divides, and publishing it is what lets anyone reproduce a run
 * instead of trusting it.
 *
 * Two things this endpoint forces. Log queries must be **chunked** — it serves
 * history three days deep but times out on wide windows, so asking for a
 * cycle's worth in one call fails outright. And block timestamps must be
 * **interpolated** rather than fetched: a busy cycle touches thousands of
 * blocks, and one `getBlock` each would be thousands of round trips against an
 * endpoint that rate-limits. Two anchors and a straight line between them is
 * exact at both ends and well inside a second in the middle, which is far finer
 * than a service integral measured in minutes needs.
 */

/**
 * Rebuilds every wallet's balance history from Transfer logs.
 *
 * The service integral needs balances over time, and the chain only records
 * changes, so the log is replayed into running balances. This is the ledger a
 * payroll run divides, and publishing it is what lets anyone reproduce a run
 * instead of trusting it.
 *
 * Timestamps come from `timestampIndex`, which measures the blocks that
 * actually carry events wherever it can afford to. An earlier version drew one
 * straight line between two anchors on the assumption of a uniform block rate;
 * a rehearsal on a chain with uneven blocks put events up to sixteen minutes
 * from where they happened, which moved real money between wallets.
 *
 * Returns null when the ledger could not be read in full, so a caller can say
 * so rather than divide an account on partial history.
 */
export async function readBalanceHistory(
  fromBlock: bigint,
  toBlock: bigint,
  signal?: AbortSignal,
  tokenOverride?: `0x${string}`,
): Promise<(BalanceEvent[] & { timestampsExact: boolean }) | null> {
  const token = tokenOverride ?? PONSAJI_TOKEN.address
  if (!token) return Object.assign([] as BalanceEvent[], { timestampsExact: true })

  const logs = await scanTransfers(token, fromBlock, toBlock, signal)
  if (logs === null) return null

  // Timestamps are resolved after the scan, so only blocks that carry an event
  // are ever asked about.
  const eventBlocks = [...new Set(logs.map((l) => l.blockNumber ?? fromBlock))]
  const timeOf = await timestampIndex(eventBlocks, fromBlock, toBlock, signal)

  logs.sort((a, b) => {
    const d = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n))
    return d !== 0 ? d : (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })

  const ZERO = '0x0000000000000000000000000000000000000000'
  const decimals = tokenOverride ? 18 : PONSAJI_TOKEN.decimals
  const balances = new Map<string, bigint>()
  const events: BalanceEvent[] = []

  for (const log of logs) {
    const at = timeOf(log.blockNumber ?? fromBlock)
    const value = log.args.value ?? 0n
    const from = (log.args.from as string).toLowerCase()
    const to = (log.args.to as string).toLowerCase()

    // A wallet sending to itself nets to no change. Emitting the decrease would
    // restart its clock for a transfer that moved nothing.
    if (from === to) continue

    if (from !== ZERO) {
      const next = (balances.get(from) ?? 0n) - value
      balances.set(from, next)
      events.push({ wallet: from as `0x${string}`, balance: Number(formatUnits(next < 0n ? 0n : next, decimals)), at })
    }
    if (to !== ZERO) {
      const next = (balances.get(to) ?? 0n) + value
      balances.set(to, next)
      events.push({ wallet: to as `0x${string}`, balance: Number(formatUnits(next, decimals)), at })
    }
  }

  // Carried on the result so a run can record whether its timestamps were
  // measured or estimated, rather than leaving a reader to assume.
  return Object.assign(events, { timestampsExact: timeOf.exact })
}

/* ------------------------------------------------------------------ */
/* Payout asset integrity                                              */
/* ------------------------------------------------------------------ */

/** EIP-1967 beacon slot, where a beacon proxy stores its beacon. */
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50' as `0x${string}`

export type PayoutAssetCheck = {
  ok: boolean
  symbol: string | null
  decimals: number | null
  totalSupply: number | null
  /** Set when the token is a beacon proxy, which makes it upgradeable. */
  beacon: `0x${string}` | null
  /** Whether it exposes a pause switch at all. */
  pausable: boolean
  paused: boolean | null
  problems: string[]
  cautions: string[]
}

/**
 * Confirms the configured payout asset really is what we think it is.
 *
 * This chain is thick with look-alikes: a search for SPCX returns dozens of
 * tokens, including `ScammingPeopleCashXtraction`, four spellings of `SpuceX`,
 * and several verified as `MIMEToken`. They are indistinguishable by symbol.
 * Two things do separate them — the impostors carry a supply of exactly
 * 1,000,000,000, the launchpad default, and a few hundred holders against the
 * real token's tens of thousands.
 *
 * Paying every holder in the wrong token would be unrecoverable, so the address
 * is asserted onchain before a run rather than trusted from a config file.
 */
export async function verifyPayoutAsset(): Promise<PayoutAssetCheck> {
  const asset = PONSAJI_TOKEN.payoutAsset
  const problems: string[] = []
  const cautions: string[] = []

  const read = async <T,>(sig: string, fn: string): Promise<T | null> => {
    try {
      return (await publicClient.readContract({ address: asset.address, abi: parseAbi([sig]), functionName: fn })) as T
    } catch {
      return null
    }
  }

  const symbol = await read<string>('function symbol() view returns (string)', 'symbol')
  const decimals = await read<number>('function decimals() view returns (uint8)', 'decimals')
  const supplyRaw = await read<bigint>('function totalSupply() view returns (uint256)', 'totalSupply')
  const paused = await read<boolean>('function paused() view returns (bool)', 'paused')

  if (symbol === null) problems.push('The configured payout asset does not answer symbol(). It may not be an ERC-20.')
  else if (symbol !== asset.symbol) problems.push(`Configured as ${asset.symbol} but the contract reports ${symbol}.`)

  if (decimals !== null && decimals !== asset.decimals) {
    problems.push(`Configured with ${asset.decimals} decimals but the contract reports ${decimals}. Payouts would be wrong by orders of magnitude.`)
  }

  const totalSupply = supplyRaw !== null ? Number(formatUnits(supplyRaw, decimals ?? asset.decimals)) : null
  // The impostor signature: a launchpad default supply on a token claiming to
  // be a share class.
  if (totalSupply !== null && Math.abs(totalSupply - 1_000_000_000) < 1) {
    problems.push(
      'Supply is exactly 1,000,000,000 — the launchpad default, and the signature of the look-alike tokens rather than a real share class. Check the address.',
    )
  }

  let beacon: `0x${string}` | null = null
  try {
    const raw = await publicClient.getStorageAt({ address: asset.address, slot: BEACON_SLOT })
    if (raw && BigInt(raw) !== 0n) beacon = (`0x${raw.slice(26)}`) as `0x${string}`
  } catch {
    /* storage unreadable; not fatal */
  }

  if (beacon) {
    cautions.push(
      `${asset.symbol} is a beacon proxy. Whoever controls the beacon (${beacon}) can replace its implementation for every holder at once.`,
    )
  }
  if (paused !== null) {
    cautions.push(
      `${asset.symbol} exposes a pause switch${paused ? ' and is currently PAUSED' : ' (currently unpaused)'}. A paused asset cannot be distributed.`,
    )
  }
  if (paused === true) problems.push(`${asset.symbol} is paused right now. A run would fail.`)

  return {
    ok: problems.length === 0,
    symbol,
    decimals,
    totalSupply,
    beacon,
    pausable: paused !== null,
    paused,
    problems,
    cautions,
  }
}

/** Price of the payout asset, from its own USDG pool. */
export async function readPayoutAssetPriceUsd(): Promise<number | null> {
  const asset = PONSAJI_TOKEN.payoutAsset
  for (const cand of COMMON_POOL_CANDIDATES) {
    const key: PoolKey = {
      currencyA: TOKENS.USDG.address,
      currencyB: asset.address,
      fee: cand.fee,
      tickSpacing: cand.tickSpacing,
      hooks: NATIVE_ETH,
    }
    const slot0 = await readSlot0(POOL_MANAGER, key)
    if (!slot0?.initialised) continue
    return priceFromSlot0({
      slot0,
      baseToken: asset.address,
      baseDecimals: asset.decimals,
      quoteToken: TOKENS.USDG.address,
      quoteDecimals: TOKENS.USDG.decimals,
    })
  }
  return null
}

export type AccountBalance = {
  /** Units of the payout asset held. */
  units: number
  usd: number | null
  assetPriceUsd: number | null
}

/**
 * What the payroll account holds.
 *
 * Read in the payout asset itself, not in ETH: the token is paired against
 * that asset, so creator fees arrive already denominated in it and there is
 * nothing to convert before paying.
 */
export async function readAccountBalance(): Promise<AccountBalance | null> {
  const account = PONSAJI_TOKEN.payrollAccount
  if (!account) return null
  try {
    const raw = await publicClient.readContract({
      address: PONSAJI_TOKEN.payoutAsset.address,
      abi: erc20BalanceAbi,
      functionName: 'balanceOf',
      args: [account],
    })
    const units = Number(formatUnits(raw, PONSAJI_TOKEN.payoutAsset.decimals))
    const price = await readPayoutAssetPriceUsd()
    return { units, usd: price !== null ? units * price : null, assetPriceUsd: price }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* What has actually been paid                                         */
/* ------------------------------------------------------------------ */

/** One settlement: a burst of payouts that left the account together. */
export type DistributionRun = {
  /** Unix ms, from the block that carried the run. */
  at: number
  /** Payout asset sent in this run, in whole units. */
  units: number
  /** Distinct wallets paid. */
  recipients: number
  /** What the viewing wallet received, when one was supplied. */
  viewerUnits: number | null
  /** The viewing wallet's share of this run. Null when no viewer, or an empty run. */
  viewerShare: number | null
}

export type DistributionHistory = {
  /** Payout asset actually sent, in whole units. */
  totalUnits: number
  totalUsd: number | null
  /** Settlements observed. A run is a burst of payouts, not a single send. */
  runs: number
  /** Distinct wallets that have received at least once. */
  walletsPaid: number
  /** Largest single run, in units. */
  largestRunUnits: number
  /** Unix ms of the most recent payout seen. */
  lastRunAt: number | null
  /** How far back the scan reached, so the figures carry their own window. */
  blocksScanned: number
  /** Set when the history could not be read in full. */
  incomplete: boolean
  /** Individual settlements, newest first. Empty until one has happened. */
  recent: DistributionRun[]
}

const EMPTY_HISTORY: DistributionHistory = {
  totalUnits: 0,
  totalUsd: null,
  runs: 0,
  walletsPaid: 0,
  largestRunUnits: 0,
  lastRunAt: null,
  blocksScanned: 0,
  incomplete: false,
  recent: [],
}

/**
 * Everything the payroll account has actually sent.
 *
 * Read from the payout asset's own Transfer logs rather than from a file this
 * app writes, so the figures on the front page are ones a stranger can
 * reproduce — which is the only kind of number this product is willing to show.
 *
 * Runs are counted as bursts: a settlement pays hundreds of wallets across a
 * few seconds of blocks, then nothing for the better part of an hour, so the
 * gap between bursts is what separates one run from the next.
 */
export async function readDistributionHistory(
  hoursBack = 72,
  signal?: AbortSignal,
  /** When given, each run also reports what this wallet received. */
  viewer?: `0x${string}` | null,
): Promise<DistributionHistory> {
  const account = PONSAJI_TOKEN.payrollAccount
  if (!account) return EMPTY_HISTORY

  try {
    const head = await publicClient.getBlockNumber()
    const span = BigInt(Math.round((hoursBack * 3600) / SECONDS_PER_BLOCK))
    const from = head > span ? head - span : 0n

    const logs = await scanTransfers(PONSAJI_TOKEN.payoutAsset.address, from, head, signal, { from: account })
    if (logs === null) return { ...EMPTY_HISTORY, blocksScanned: Number(span), incomplete: true }

    logs.sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)))

    // Settlements are few, so their times are measured rather than estimated
    // between anchors. A run's date is stamped on it here; getting it from a
    // straight line would put it minutes from when it happened.
    const timeOf = await timestampIndex([...new Set(logs.map((l) => l.blockNumber ?? from))], from, head, signal)

    const wallets = new Set<string>()
    const decimals = PONSAJI_TOKEN.payoutAsset.decimals
    const holder = viewer?.toLowerCase() ?? null
    // A settlement spans seconds; the next is the better part of an hour away.
    const gap = BigInt(Math.round(600 / SECONDS_PER_BLOCK))

    type Bucket = { at: number; raw: bigint; to: Set<string>; viewerRaw: bigint }
    const buckets: Bucket[] = []
    let totalRaw = 0n
    let previousBlock: bigint | null = null

    for (const log of logs) {
      const value = log.args.value ?? 0n
      const block = log.blockNumber ?? from
      const to = (log.args.to as string).toLowerCase()
      totalRaw += value
      wallets.add(to)

      if (previousBlock === null || block - previousBlock > gap) {
        buckets.push({ at: timeOf(block), raw: 0n, to: new Set(), viewerRaw: 0n })
      }
      const run = buckets[buckets.length - 1]
      run.raw += value
      run.to.add(to)
      if (holder && to === holder) run.viewerRaw += value
      previousBlock = block
    }

    const price = await readPayoutAssetPriceUsd().catch(() => null)
    const totalUnits = Number(formatUnits(totalRaw, decimals))
    const largestRun = buckets.reduce((m, b) => (b.raw > m ? b.raw : m), 0n)

    const recent: DistributionRun[] = buckets
      .map((b) => {
        const units = Number(formatUnits(b.raw, decimals))
        const viewerUnits = holder ? Number(formatUnits(b.viewerRaw, decimals)) : null
        return {
          at: b.at,
          units,
          recipients: b.to.size,
          viewerUnits,
          viewerShare: viewerUnits !== null && units > 0 ? viewerUnits / units : null,
        }
      })
      .reverse()

    return {
      totalUnits,
      totalUsd: price !== null ? totalUnits * price : null,
      runs: buckets.length,
      walletsPaid: wallets.size,
      largestRunUnits: Number(formatUnits(largestRun, decimals)),
      lastRunAt: buckets.length ? buckets[buckets.length - 1].at : null,
      blocksScanned: Number(span),
      incomplete: false,
      recent,
    }
  } catch {
    return { ...EMPTY_HISTORY, incomplete: true }
  }
}

/* ------------------------------------------------------------------ */
/* A run, end to end                                                   */
/* ------------------------------------------------------------------ */

export type PayrollState = {
  market: TokenMarket | null
  cycle: { index: number; closesAt: number } | null
  account: AccountBalance | null
  accountUsd: number | null
  /** A projection of the next run against the current ledger, not a promise. */
  projected: PayrollRun | null
  ledgerEvents: number
  blockedBy: string | null
}

/**
 * Projects the next payroll run against the ledger as it stands.
 *
 * This is a projection and never a schedule: the run's exact moment is seeded
 * and deliberately unpublished, because a published moment is one a late buyer
 * can trade around — which is the behaviour the service integral exists to
 * make worthless. What can be shown honestly is the arithmetic that will be
 * applied whenever the run lands.
 */
export async function projectPayroll(ethUsd: number | null, signal?: AbortSignal): Promise<PayrollState> {
  const empty: PayrollState = {
    market: null,
    cycle: null,
    account: null,
    accountUsd: null,
    projected: null,
    ledgerEvents: 0,
    blockedBy: null,
  }

  if (!isLaunched()) {
    return { ...empty, blockedBy: 'The token is not deployed yet, so there is no ledger to divide.' }
  }

  const market = await discoverMarket(ethUsd, signal)
  if (!market) {
    return { ...empty, blockedBy: 'No pool holding liquidity was found for the token yet.' }
  }

  const head = await publicClient.getBlockNumber()
  const sinceLaunch = Math.max(0, Date.now() - market.launchedAt) / 1000
  const span = BigInt(Math.min(2_000_000, Math.ceil(sinceLaunch / SECONDS_PER_BLOCK) + 1000))
  const events = await readBalanceHistory(head > span ? head - span : 0n, head, signal)
  if (events === null) {
    return {
      ...empty,
      market,
      blockedBy:
        'The ledger could not be read in full from this endpoint. Nothing is shown rather than a partial history, because a hole understates somebody’s service.',
    }
  }

  // Close on chain time, not on this browser's clock: the integral is over
  // block timestamps, and a clock behind the chain silently drops the most
  // recent service.
  const headBlockForClose = await publicClient.getBlock({ blockNumber: head })
  const now = Number(headBlockForClose.timestamp) * 1000
  const cycle = currentCycle(market.launchedAt, now)
  const records = computeService(events, now)
  const account = await readAccountBalance()
  const accountUsd = account?.usd ?? null

  return {
    market,
    cycle,
    account,
    accountUsd,
    ledgerEvents: events.length,
    projected:
      accountUsd !== null
        ? runPayroll({
            records,
            accountUsd,
            closedAt: now,
            minimumBalance: PONSAJI_TOKEN.minimumBalance,
          })
        : null,
    blockedBy:
      account === null
        ? `The payroll account's ${PONSAJI_TOKEN.payoutAsset.symbol} balance could not be read.`
        : accountUsd === null
          ? `${PONSAJI_TOKEN.payoutAsset.symbol} has no readable price, so the account cannot be valued.`
          : null,
  }
}

/* ------------------------------------------------------------------ */
/* One wallet's ledger                                                 */
/* ------------------------------------------------------------------ */

export type BalancePoint = {
  at: number
  /** Balance in whole tokens after this transfer. */
  balance: number
  /** Signed change that produced it. Negative means the clock restarted here. */
  change: number
}

export type WalletLedger = {
  points: BalancePoint[]
  /** Balance now, in whole tokens. */
  balance: number
  /** Accrued token-minutes since the last reduction, at `readAt`. */
  service: number
  /** When the clock last restarted. Null when the wallet never held. */
  serviceStart: number | null
  /** Minutes of unbroken service. */
  minutesHeld: number
  /** Chain time the figures were taken at, so nothing is measured off a local clock. */
  readAt: number
  /** Set when the wallet's history could not be read in full. */
  incomplete: boolean
}

/**
 * One wallet's balance over time, and the service it has accrued.
 *
 * Scanned by the two indexed sides of Transfer rather than by replaying the
 * whole ledger: a holder looking at their own page should not pay for a scan of
 * everybody's. The arithmetic deliberately matches computeService, because a
 * holder checking their own figure against a run must not find two answers.
 */
export async function readWalletLedger(
  wallet: `0x${string}`,
  signal?: AbortSignal,
): Promise<WalletLedger | null> {
  const token = PONSAJI_TOKEN.address
  if (!token) return null

  const empty = (incomplete: boolean, readAt: number): WalletLedger => ({
    points: [],
    balance: 0,
    service: 0,
    serviceStart: null,
    minutesHeld: 0,
    readAt,
    incomplete,
  })

  try {
    const head = await publicClient.getBlockNumber()
    const headBlock = await publicClient.getBlock({ blockNumber: head })
    const readAt = Number(headBlock.timestamp) * 1000

    const launchedAt = PONSAJI_TOKEN.launchedAt ?? readAt
    const sinceLaunch = Math.max(0, (readAt - launchedAt) / 1000)
    const span = BigInt(Math.min(2_000_000, Math.ceil(sinceLaunch / SECONDS_PER_BLOCK) + 2_000))
    const from = head > span ? head - span : 0n

    const [sent, received] = await Promise.all([
      scanTransfers(token, from, head, signal, { from: wallet }),
      scanTransfers(token, from, head, signal, { to: wallet }),
    ])
    if (sent === null || received === null) return empty(true, readAt)

    const logs = [...sent, ...received].sort((a, b) => {
      const d = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n))
      return d !== 0 ? d : (a.logIndex ?? 0) - (b.logIndex ?? 0)
    })
    if (logs.length === 0) return empty(false, readAt)

    const timeOf = await timestampIndex([...new Set(logs.map((l) => l.blockNumber ?? from))], from, head, signal)

    const decimals = PONSAJI_TOKEN.decimals
    const self = wallet.toLowerCase()
    const points: BalancePoint[] = []
    let raw = 0n
    let service = 0
    let since: number | null = null
    let last = 0

    for (const log of logs) {
      const value = log.args.value ?? 0n
      const outgoing = (log.args.from as string).toLowerCase() === self
      const incoming = (log.args.to as string).toLowerCase() === self
      // A transfer to yourself nets to nothing; charging it as a reduction
      // would restart the clock for a move that changed no balance.
      if (outgoing && incoming) continue

      const at = timeOf(log.blockNumber ?? from)
      const before = Number(formatUnits(raw, decimals))
      raw = outgoing ? raw - value : raw + value
      const after = Number(formatUnits(raw < 0n ? 0n : raw, decimals))

      if (outgoing) {
        // Any reduction forfeits accrued service and restarts the clock.
        service = 0
        since = at
      } else {
        if (since !== null) service += before * ((at - since) / 60_000)
        since = at
      }
      points.push({ at, balance: after, change: after - before })
      last = at
    }

    const balance = Number(formatUnits(raw < 0n ? 0n : raw, decimals))
    const start = since ?? last
    return {
      points,
      balance,
      service: service + balance * ((readAt - start) / 60_000),
      serviceStart: points.length ? start : null,
      minutesHeld: (readAt - start) / 60_000,
      readAt,
      incomplete: false,
    }
  } catch {
    return null
  }
}
