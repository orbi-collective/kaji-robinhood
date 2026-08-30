import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem'
import { poolManagerAbi } from './abi'
import { publicClient } from './client'

/**
 * Uniswap v4 pool reads.
 *
 * v4 keeps every pool inside one PoolManager singleton and exposes state only
 * through `extsload`, so reading a price means deriving the pool id from its
 * key and hashing your way to the right storage slot. There is no `getPool`
 * and no per-pool contract to call.
 *
 * This matters for PONSAJI because it is the only on-chain price source on this
 * chain for both the fee-distribution tokens and the tokenized stocks they pay
 * out. Without it the break-even model would need a number the user supplies.
 */

/** Storage slot of the PoolManager's `pools` mapping in the canonical deployment. */
const POOLS_SLOT = 6n

export const DYNAMIC_FEE_FLAG = 0x800000

export type PoolKey = {
  currencyA: `0x${string}`
  currencyB: `0x${string}`
  fee: number
  tickSpacing: number
  hooks: `0x${string}`
}

/** v4 sorts currencies by address; the key is invalid otherwise. */
export function poolId(key: PoolKey): `0x${string}` {
  const [c0, c1] =
    BigInt(key.currencyA) < BigInt(key.currencyB) ? [key.currencyA, key.currencyB] : [key.currencyB, key.currencyA]
  return keccak256(
    encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [
      c0,
      c1,
      key.fee,
      key.tickSpacing,
      key.hooks,
    ]),
  )
}

export type Slot0 = {
  sqrtPriceX96: bigint
  tick: number
  /** True when the pool is initialised. An uninitialised key reads as all zeroes. */
  initialised: boolean
}

/** Reads a pool's slot0. Returns `initialised: false` for a key that has no pool. */
export async function readSlot0(
  poolManager: `0x${string}`,
  key: PoolKey,
  signal?: AbortSignal,
): Promise<Slot0 | null> {
  const id = poolId(key)
  const slot = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256'), [id, POOLS_SLOT]))
  try {
    const raw = await publicClient.readContract({
      address: poolManager,
      abi: poolManagerAbi,
      functionName: 'extsload',
      args: [slot],
    })
    if (signal?.aborted) return null
    const packed = BigInt(raw)
    if (packed === 0n) return { sqrtPriceX96: 0n, tick: 0, initialised: false }
    return {
      sqrtPriceX96: packed & ((1n << 160n) - 1n),
      tick: Number(BigInt.asIntN(24, (packed >> 160n) & ((1n << 24n) - 1n))),
      initialised: true,
    }
  } catch {
    return null
  }
}

/**
 * Price of `base` denominated in `quote`, from a pool's sqrt price.
 *
 * sqrtPriceX96 encodes currency1 per currency0 in raw units, so both the
 * ordering and the decimal difference have to be undone before the number
 * means anything.
 */
export function priceFromSlot0(args: {
  slot0: Slot0
  baseToken: `0x${string}`
  baseDecimals: number
  quoteToken: `0x${string}`
  quoteDecimals: number
}): number | null {
  const { slot0, baseToken, baseDecimals, quoteToken, quoteDecimals } = args
  if (!slot0.initialised || slot0.sqrtPriceX96 === 0n) return null

  // (sqrtPriceX96 / 2^96)^2 = currency1 per currency0, in raw units.
  const ratio = (Number(slot0.sqrtPriceX96) / 2 ** 96) ** 2
  if (!Number.isFinite(ratio) || ratio <= 0) return null

  const baseIsCurrency0 = BigInt(baseToken) < BigInt(quoteToken)
  // Raw ratio → whole-unit ratio.
  const scale = 10 ** (baseDecimals - quoteDecimals)
  const price = baseIsCurrency0 ? ratio * scale : (1 / ratio) * scale

  return Number.isFinite(price) && price > 0 ? price : null
}

/**
 * Finds the live pool for a pair by trying candidate keys.
 *
 * v4 pool ids are opaque, so a pool whose fee tier and tick spacing were not
 * published has to be discovered. Candidates are ordered most-likely-first and
 * the search stops at the first initialised hit; callers cache the result,
 * because this endpoint rate-limits and the answer never changes.
 */
export async function discoverPool(
  poolManager: `0x${string}`,
  pair: { currencyA: `0x${string}`; currencyB: `0x${string}`; hooks: `0x${string}` },
  candidates: { fee: number; tickSpacing: number }[],
  signal?: AbortSignal,
): Promise<{ key: PoolKey; slot0: Slot0 } | null> {
  for (const c of candidates) {
    if (signal?.aborted) return null
    const key: PoolKey = { ...pair, fee: c.fee, tickSpacing: c.tickSpacing }
    const slot0 = await readSlot0(poolManager, key, signal)
    if (slot0?.initialised) return { key, slot0 }
  }
  return null
}

/**
 * Candidate keys, most likely first.
 *
 * Both venue families on this chain turned out to sit on standard tiers — the
 * distribution tokens on 1% / 200 with their hook attached, the tokenized
 * stocks on 0.30% / 60 with no hook — so the common tiers are tried before the
 * dynamic-fee flag.
 */
export const COMMON_POOL_CANDIDATES: { fee: number; tickSpacing: number }[] = [
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
  { fee: 500, tickSpacing: 10 },
  { fee: 100, tickSpacing: 1 },
  { fee: DYNAMIC_FEE_FLAG, tickSpacing: 60 },
  { fee: DYNAMIC_FEE_FLAG, tickSpacing: 200 },
]

/**
 * Reads slot0 and liquidity for a pool whose id is already known.
 *
 * Some venues publish the pool id but not the fee tier and tick spacing that
 * produced it, which makes the key underivable and the id the only way in.
 */
export async function readPoolStateById(
  poolManager: `0x${string}`,
  id: `0x${string}`,
): Promise<{ sqrtPriceX96: bigint; liquidity: bigint } | null> {
  const stateSlot = BigInt(keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256'), [id, POOLS_SLOT])))
  const word = (offset: bigint) =>
    `0x${(stateSlot + offset).toString(16).padStart(64, '0')}` as `0x${string}`
  try {
    const [s0, liq] = await Promise.all([
      publicClient.readContract({ address: poolManager, abi: poolManagerAbi, functionName: 'extsload', args: [word(0n)] }),
      publicClient.readContract({ address: poolManager, abi: poolManagerAbi, functionName: 'extsload', args: [word(3n)] }),
    ])
    const packed = BigInt(s0)
    if (packed === 0n) return null
    return { sqrtPriceX96: packed & ((1n << 160n) - 1n), liquidity: BigInt(liq) }
  } catch {
    return null
  }
}

/**
 * In-range liquidity, `L`, from the pool's state slot.
 *
 * Laid out three words after slot0: slot0, feeGrowthGlobal0, feeGrowthGlobal1,
 * then liquidity.
 */
export async function readPoolLiquidity(
  poolManager: `0x${string}`,
  key: PoolKey,
): Promise<bigint | null> {
  const id = poolId(key)
  const stateSlot = BigInt(keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256'), [id, POOLS_SLOT])))
  const slot = `0x${(stateSlot + 3n).toString(16).padStart(64, '0')}` as `0x${string}`
  try {
    const raw = await publicClient.readContract({
      address: poolManager,
      abi: poolManagerAbi,
      functionName: 'extsload',
      args: [slot],
    })
    return BigInt(raw)
  } catch {
    return null
  }
}

/**
 * How much of the quote asset a seller can take out before the token's price
 * falls by `impact`.
 *
 * This is exit depth as a holder actually experiences it, and it is a very
 * different quantity from market capitalisation — a token can be worth $27M in
 * aggregate while ten thousand dollars of selling moves it five percent.
 *
 * Derived from concentrated-liquidity maths on the in-range position:
 * selling the token raises currency1-per-currency0, and the seller receives
 * currency0, so `amount0 = L · (1/√P − 1/√P')` with `√P' = √P / √(1 − impact)`.
 *
 * It counts only liquidity in the current range, so it *understates* depth
 * whenever more sits further out — validated against Quotrons' own executable
 * quoter, where it came in roughly a third below the real fill. Understating
 * exit depth is the safe direction for a check that decides whether a position
 * can be unwound, but it is an approximation and is labelled as one.
 */
export function exitDepth(args: {
  liquidity: bigint
  sqrtPriceX96: bigint
  /** Fraction of price given up, e.g. 0.05 for five percent. */
  impact: number
  quoteDecimals: number
  /**
   * Whether the asset the seller receives is currency0.
   *
   * The two cases are different formulas, not a sign flip, and getting it
   * backwards silently returns a number in the wrong token — which is worse
   * than returning nothing. Defaults to true because the distribution tokens
   * PONSAJI reads all quote in native ETH, which sorts to currency0.
   */
  quoteIsCurrency0?: boolean
}): number | null {
  const { liquidity, sqrtPriceX96, impact, quoteDecimals, quoteIsCurrency0 = true } = args
  if (liquidity <= 0n || sqrtPriceX96 <= 0n) return null
  if (!(impact > 0) || impact >= 1) return null

  const sqrtP = Number(sqrtPriceX96) / 2 ** 96
  if (!Number.isFinite(sqrtP) || sqrtP <= 0) return null

  const L = Number(liquidity) / 10 ** quoteDecimals
  const k = 1 - Math.sqrt(1 - impact)

  // Selling the base pushes the pair's price against it. Which side the seller
  // receives decides which of v4's two amount formulas applies:
  //   quote is currency0 → amount0 = L·(1/√P − 1/√P')
  //   quote is currency1 → amount1 = L·(√P − √P')
  const amount = quoteIsCurrency0 ? L * (1 / sqrtP) * k : L * sqrtP * k

  return Number.isFinite(amount) && amount > 0 ? amount : null
}
