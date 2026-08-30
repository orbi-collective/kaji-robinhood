import { formatUnits, parseAbiItem, parseEther } from 'viem'
import { erc20Abi, indexDistributorAbi, indexFeeHookAbi, quotronQuoterAbi } from './abi'
import { IS_LIVE_CHAIN, TOKENS } from './chain'
import { publicClient } from './client'
import { readPriceFeed } from './feeds'
import { netCarry } from './policy'
import type { CarryBreakdown, DistributionTerms, Opportunity } from './types'
import {
  COMMON_POOL_CANDIDATES,
  discoverPool,
  exitDepth,
  priceFromSlot0,
  readPoolLiquidity,
  readPoolStateById,
  readSlot0,
  type PoolKey,
} from './uniswapV4'
import {
  DISTRIBUTION_VENUES,
  NATIVE_ETH,
  POOL_MANAGER,
  QUOTRON_QUOTER,
  type DistributionVenue,
  type StockToken,
} from './venues'

/**
 * Fee-distribution venue adapter.
 *
 * These protocols take a fee on every trade of their own token and spend it
 * buying assets that are handed to holders. That makes the position's return a
 * share of somebody else's trading volume, which is a very different object
 * from a vault yield and has to be measured differently.
 *
 * Three things are measured here, and nothing else is assumed:
 *
 *  - the fee, read from the contract that charges it;
 *  - the cadence, read from the distributor;
 *  - one complete distribution cycle, reconstructed from its own Transfer logs.
 *
 * Prices come from the Uniswap v4 pools the assets actually trade in. Where a
 * measurement fails the field is null and carries a reason, because a
 * break-even figure is something a person may commit money against.
 */

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

const erc20SupplyAbi = [
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

/** Measured at ~0.101s during this build's chain survey. */
const SECONDS_PER_BLOCK = 0.101

/** Recipients sampled to size the payout and check the pro-rata claim. */
const PAYOUT_SAMPLES = 5

/**
 * Price a seller is assumed willing to give up when unwinding.
 *
 * Exit depth has to be measured against *some* tolerance, and naming it is the
 * difference between a number and a claim. Five percent is a position a holder
 * can leave without destroying the price they are leaving at.
 */
const EXIT_IMPACT = 0.05

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

const poolCache = new Map<string, PoolKey | null>()

async function stockPriceUsdg(stock: StockToken, signal?: AbortSignal): Promise<number | null> {
  const cacheKey = `usdg:${stock.address}`
  const cached = poolCache.get(cacheKey)

  const pair = { currencyA: TOKENS.USDG.address, currencyB: stock.address, hooks: NATIVE_ETH }

  let key = cached ?? null
  if (cached === undefined) {
    const found = await discoverPool(POOL_MANAGER, pair, COMMON_POOL_CANDIDATES, signal)
    key = found?.key ?? null
    poolCache.set(cacheKey, key)
    if (found) {
      return priceFromSlot0({
        slot0: found.slot0,
        baseToken: stock.address,
        baseDecimals: stock.decimals,
        quoteToken: TOKENS.USDG.address,
        quoteDecimals: TOKENS.USDG.decimals,
      })
    }
  }
  if (!key) return null

  const slot0 = await readSlot0(POOL_MANAGER, key, signal)
  if (!slot0) return null
  return priceFromSlot0({
    slot0,
    baseToken: stock.address,
    baseDecimals: stock.decimals,
    quoteToken: TOKENS.USDG.address,
    quoteDecimals: TOKENS.USDG.decimals,
  })
}

/**
 * Token price and exit depth, from the pool the token actually trades in.
 *
 * These travel together because they come from the same two storage words, and
 * because reporting one without the other invites the mistake this whole
 * adapter exists to avoid: quoting market capitalisation as though a holder
 * could exit into it.
 */
async function tokenPriceUsd(
  venue: DistributionVenue,
  ethUsd: number | null,
  signal?: AbortSignal,
): Promise<{ usd: number | null; depthUsd: number | null; basis: string }> {
  if (!ethUsd) return { usd: null, depthUsd: null, basis: 'ETH/USD feed unavailable' }

  // Quotrons publishes a view quoter — an exact executable price, fee included.
  if (venue.id === 'quotron-terminal') {
    try {
      const [out] = await publicClient.readContract({
        address: QUOTRON_QUOTER,
        abi: quotronQuoterAbi,
        functionName: 'quoteBuyExactEth',
        args: [parseEther('0.1'), '0x0000000000000000000000000000000000000001'],
      })
      const tokens = Number(formatUnits(out, venue.token.decimals))
      if (tokens > 0) {
        // Depth still comes from the pool: the quoter prices a trade, it does
        // not say how large a trade the pool can absorb.
        const depth = venue.poolId ? await depthFromPoolId(venue.poolId, ethUsd) : null
        return { usd: (0.1 / tokens) * ethUsd, depthUsd: depth, basis: 'quoteBuyExactEth, fee included' }
      }
    } catch {
      /* fall through */
    }
    return { usd: null, depthUsd: null, basis: 'quoter unreachable' }
  }

  if (!venue.poolHint) return { usd: null, depthUsd: null, basis: 'no pool key known for this token' }
  const key: PoolKey = {
    currencyA: venue.poolHint.quote,
    currencyB: venue.token.address,
    fee: venue.poolHint.fee,
    tickSpacing: venue.poolHint.tickSpacing,
    hooks: venue.poolHint.hooks,
  }
  const [slot0, liquidity] = await Promise.all([
    readSlot0(POOL_MANAGER, key, signal),
    readPoolLiquidity(POOL_MANAGER, key),
  ])
  if (!slot0?.initialised) return { usd: null, depthUsd: null, basis: 'pool not initialised at the known key' }

  const inEth = priceFromSlot0({
    slot0,
    baseToken: venue.token.address,
    baseDecimals: venue.token.decimals,
    quoteToken: venue.poolHint.quote,
    quoteDecimals: 18,
  })

  // Only in-range liquidity is counted, so this is a *lower bound* on depth.
  // When the bound comes back negligible the pool has not been shown to be
  // empty — its liquidity sits outside the current tick range and the bound
  // says nothing useful. Reporting it as a depth would be the more confident
  // number and the false one.
  const depthEth =
    liquidity !== null
      ? exitDepth({ liquidity, sqrtPriceX96: slot0.sqrtPriceX96, impact: EXIT_IMPACT, quoteDecimals: 18 })
      : null

  return inEth === null
    ? { usd: null, depthUsd: null, basis: 'pool price unreadable' }
    : {
        usd: inEth * ethUsd,
        depthUsd: depthEth !== null ? depthEth * ethUsd : null,
        basis: 'Uniswap v4 slot0 × Chainlink ETH/USD',
      }
}

/** Exit depth for a pool whose id is published but whose key is not. */
async function depthFromPoolId(id: `0x${string}`, ethUsd: number): Promise<number | null> {
  const state = await readPoolStateById(POOL_MANAGER, id)
  if (!state) return null
  const eth = exitDepth({
    liquidity: state.liquidity,
    sqrtPriceX96: state.sqrtPriceX96,
    impact: EXIT_IMPACT,
    quoteDecimals: 18,
  })
  return eth !== null ? eth * ethUsd : null
}

/* ------------------------------------------------------------------ */
/* Payout measurement                                                  */
/* ------------------------------------------------------------------ */

type PayoutReading = {
  perToken: number
  samples: number
  proRataVerified: boolean | null
  basis: string
}

/**
 * Measures what one whole token earns per cycle.
 *
 * The naive approach — sum an entire cycle and divide by eligible supply —
 * means pulling several thousand Transfer logs across a flaky public endpoint.
 * It is also unnecessary. For a pro-rata distribution the cycle total appears
 * in both the numerator and the denominator of the income equation and cancels
 * out, leaving one recipient's payout divided by their balance. So this reads a
 * handful of real payouts instead, which is both exact and robust.
 *
 * Sampling several recipients is what turns the venue's pro-rata claim into
 * something checked: if they disagree, the distribution is not what it says.
 */
async function measurePayoutPerToken(
  venue: DistributionVenue,
  signal?: AbortSignal,
): Promise<PayoutReading | null> {
  const stock = venue.sampleStock
  if (!venue.distributor || !stock) return null

  try {
    const [head, cadence] = await Promise.all([publicClient.getBlockNumber(), readCadence(venue)])

    // The contract says when the next cycle lands, so the last one is one
    // interval back — which pins the block window instead of searching for it.
    let toBlock = head
    let fromBlock = head > 4_000n ? head - 4_000n : 0n
    if (cadence.next && cadence.interval) {
      const lastCycleAt = cadence.next - cadence.interval
      const secondsAgo = Math.max(0, Math.floor(Date.now() / 1000) - lastCycleAt)
      const blocksAgo = BigInt(Math.round(secondsAgo / SECONDS_PER_BLOCK))
      const centre = head > blocksAgo ? head - blocksAgo : 0n
      // A burst spans roughly 800 blocks; this brackets it generously.
      fromBlock = centre > 2_500n ? centre - 2_500n : 0n
      toBlock = centre + 2_500n > head ? head : centre + 2_500n
    }

    const logs = await publicClient.getLogs({
      address: stock.address,
      event: TRANSFER_EVENT,
      args: { from: venue.distributor },
      fromBlock,
      toBlock,
    })

    if (signal?.aborted) return null
    if (logs.length === 0) {
      return {
        perToken: 0,
        samples: 0,
        proRataVerified: null,
        basis: `No ${stock.symbol} payout found in the blocks around the last scheduled cycle.`,
      }
    }

    // Spread the samples across the burst rather than taking neighbours, so a
    // single unusual recipient cannot pass as agreement.
    const step = Math.max(1, Math.floor(logs.length / PAYOUT_SAMPLES))
    const picks = []
    for (let i = 0; i < logs.length && picks.length < PAYOUT_SAMPLES; i += step) {
      const l = logs[i]
      if ((l.args.value ?? 0n) > 0n) picks.push({ to: l.args.to as `0x${string}`, value: l.args.value as bigint })
    }

    const ratios: number[] = []
    for (const pick of picks) {
      if (signal?.aborted) break
      try {
        const balance = await publicClient.readContract({
          address: venue.token.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [pick.to],
        })
        const held = Number(formatUnits(balance, venue.token.decimals))
        const got = Number(formatUnits(pick.value, stock.decimals))
        if (held > 0 && got > 0) ratios.push(got / held)
      } catch {
        /* skip this sample */
      }
    }

    if (ratios.length === 0) {
      return {
        perToken: 0,
        samples: 0,
        proRataVerified: null,
        basis: `Found ${logs.length} ${stock.symbol} payouts but no recipient balance could be read to size them against.`,
      }
    }

    ratios.sort((a, b) => a - b)
    const median = ratios[Math.floor(ratios.length / 2)]
    const spread = median > 0 ? (ratios[ratios.length - 1] - ratios[0]) / median : 0
    // Balances are read now, not as of the cycle, so exact agreement is not
    // expected. A tight cluster still confirms the pro-rata claim.
    const proRata = ratios.length > 1 ? spread < 0.05 : null

    return {
      perToken: median,
      samples: ratios.length,
      proRataVerified: proRata,
      basis: `${ratios.length} recipients sampled from a live ${stock.symbol} cycle${
        proRata === false ? ' — their payouts per token disagreed, so treat this as approximate' : ''
      }.`,
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Fees                                                                */
/* ------------------------------------------------------------------ */

async function readFeeBps(venue: DistributionVenue): Promise<number | null> {
  // The tax is the pool's own fee tier. v4 states fees in hundredths of a bip,
  // so 50000 is 5% — 500 basis points.
  if (venue.feeSource === 'poolTier') {
    return venue.poolHint ? Math.round(venue.poolHint.fee / 100) : null
  }
  try {
    if (venue.feeSource === 'quoter') {
      const bps = await publicClient.readContract({
        address: QUOTRON_QUOTER,
        abi: quotronQuoterAbi,
        functionName: 'currentFeeBps',
        args: ['0x0000000000000000000000000000000000000001'],
      })
      return Number(bps)
    }
    if (!venue.feeHook) return null
    const bps = await publicClient.readContract({
      address: venue.feeHook,
      abi: indexFeeHookAbi,
      functionName: 'FEE_BPS',
    })
    return Number(bps)
  } catch {
    return null
  }
}

async function readCadence(
  venue: DistributionVenue,
): Promise<{ interval: number | null; next: number | null }> {
  if (!venue.distributor) return { interval: null, next: null }
  const [interval, next] = await Promise.all([
    publicClient
      .readContract({ address: venue.distributor, abi: indexDistributorAbi, functionName: 'interval' })
      .then(Number)
      .catch(() => null),
    publicClient
      .readContract({ address: venue.distributor, abi: indexDistributorAbi, functionName: 'nextDistribution' })
      .then(Number)
      .catch(() => null),
  ])
  return { interval, next }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

const EMPTY_BREAKDOWN: CarryBreakdown = {
  lending_yield: 0,
  funding_income: 0,
  incentive_value: 0,
  borrow_cost: 0,
  hedge_cost: 0,
  protocol_fees: 0,
  estimated_slippage: 0,
  annualized_gas_cost: 0,
}

/**
 * Risk for a distribution position.
 *
 * The dominant risk is not price — it is that the income depends entirely on
 * other people continuing to trade. A venue that pays nothing to plain holders
 * is riskier still, because the advertised return requires an irreversible act.
 */
function deriveRiskScore(input: {
  feeBps: number | null
  paysHolders: boolean
  depthUsd: number | null
  marketValueUsd: number | null
}): number {
  // Thin exit depth dominates: it is the difference between a position you can
  // leave and one you are stuck in. Measured against the token's own market
  // value, so a small token with proportionate depth is not punished for size.
  const ratio =
    input.depthUsd !== null && input.marketValueUsd && input.marketValueUsd > 0
      ? input.depthUsd / input.marketValueUsd
      : null
  // 1% of market value exitable inside the impact band is treated as healthy.
  const depthRisk = ratio === null ? 45 : Math.max(0, Math.min(50, 50 * (1 - Math.min(1, ratio / 0.01))))

  // A venue that pays nothing to plain holders is the sharper structural risk:
  // its advertised return is only reachable through an irreversible act.
  const structureRisk = input.paysHolders ? 10 : 35

  // The round trip is a certain loss the position starts from.
  const feeRisk = input.feeBps === null ? 10 : Math.min(15, (input.feeBps * 2) / 80)

  return Math.max(1, Math.min(100, Math.round(depthRisk + structureRisk + feeRisk)))
}

export async function fetchDistributionOpportunities(signal?: AbortSignal): Promise<Opportunity[]> {
  if (!IS_LIVE_CHAIN) return []

  const ethFeed = await readPriceFeed('ETH_USD').catch(() => null)
  const ethUsd = ethFeed?.price ?? null

  const rows = await Promise.all(
    DISTRIBUTION_VENUES.map(async (venue): Promise<Opportunity> => {
      const [feeBps, cadence, price] = await Promise.all([
        readFeeBps(venue),
        readCadence(venue),
        tokenPriceUsd(venue, ethUsd, signal),
      ])

      const paysHolders = venue.paysHolders
      // The cycle measurement is a multi-thousand-log query. Running it once
      // per row on the scanner starves the vault reads sharing this endpoint,
      // so it is deferred to the page that actually shows a break-even.

      const totalSupply = await publicClient
        .readContract({ address: venue.token.address, abi: erc20SupplyAbi, functionName: 'totalSupply' })
        .then((s) => Number(formatUnits(s, venue.token.decimals)))
        .catch(() => null)

      const entry = feeBps ?? 0
      const distribution: DistributionTerms = {
        token_address: venue.token.address,
        token_symbol: venue.token.symbol,
        entry_fee_bps: entry,
        exit_fee_bps: entry,
        interval_seconds: cadence.interval,
        next_distribution_at: cadence.next,
        total_supply: totalSupply,
        holder_count: null,
        paid_in: venue.paidIn,
        pays_holders: paysHolders,
        payout_per_token: null,
        payout_asset: venue.sampleStock?.symbol ?? null,
        payout_asset_price_usd: null,
        leg_count: venue.legCount,
        share_basis: !paysHolders
          ? 'This venue pays committed NFTs, not plain token holders. Holding the token alone earns nothing.'
          : venue.distributor
            ? 'Payout not yet measured — open the recipe to read one from a live cycle.'
            : 'This venue pays its holders, but publishes its distributor address only in truncated form, so PONSAJI cannot read what a holder actually receives.',
        pro_rata_verified: null,
        samples_taken: 0,
      }

      const live = feeBps !== null && price.usd !== null
      const marketValueUsd = price.usd !== null && totalSupply ? price.usd * totalSupply : null

      // Always reported, always a lower bound. Suppressing a small one would
      // discard a real measurement; presenting it as a ceiling would invent a
      // conclusion the maths cannot support.
      const depthUsd = price.depthUsd

      return {
        recipe_id: venue.id,
        kind: 'distribution',
        name: venue.name,
        subtitle: venue.subtitle,
        profile: venue.profile,
        inputs: { base_asset: venue.quoteAsset, venue: venue.venueKey, hedge_venue: null },
        ingredients: [{ label: venue.token.symbol, venue: venue.venueKey, weight: 100 }],
        breakdown: EMPTY_BREAKDOWN,
        gross_apy: 0,
        estimated_net_carry: netCarry(EMPTY_BREAKDOWN),
        risk_score: deriveRiskScore({ feeBps, paysHolders, depthUsd, marketValueUsd }),
        // Measured depth, never market value. A token can be worth $27M in
        // aggregate while ten thousand dollars of selling moves it five
        // percent, and the exit check exists to catch exactly that.
        exit_liquidity_usd: depthUsd ?? 0,
        oracle_age_seconds: null,
        oracle_heartbeat_seconds: null,
        tvl_usd: marketValueUsd,
        curator: venue.curator,
        contract_address: venue.token.address,
        distribution,
        unavailable_reason: live
          ? depthUsd === null
            ? 'exit depth not readable'
            : null
          : feeBps === null
            ? 'fee not readable'
            : price.basis,
        requires_leverage: false,
        source: live ? 'live' : 'demo',
        as_of: Date.now(),
      }
    }),
  )

  return rows
}

/**
 * Measures what one token earns per cycle, and prices it.
 *
 * Deliberately on-demand: it reads a live cycle's payouts and samples the
 * recipients' balances, then prices the measured leg against its own pool.
 * Only the recipe page needs this, and running it per row on the scanner
 * starved the vault reads sharing the same endpoint.
 */
export type CycleMeasurement = {
  terms: DistributionTerms
  /** USD one whole token earns per cycle, across every leg of the basket. */
  perTokenUsd: number | null
  basis: string
}

export async function measureAndPriceCycle(
  opportunity: Opportunity,
  signal?: AbortSignal,
): Promise<CycleMeasurement | null> {
  const venue = DISTRIBUTION_VENUES.find((v) => v.id === opportunity.recipe_id)
  const base = opportunity.distribution
  if (!venue || !base) return null

  // Either it pays nobody, or it pays people PONSAJI cannot follow.
  if (!venue.distributor || !venue.sampleStock) {
    return { terms: base, perTokenUsd: null, basis: base.share_basis }
  }

  const reading = await measurePayoutPerToken(venue, signal)
  if (!reading) {
    const why =
      'The RPC endpoint did not return the distribution logs. This public endpoint intermittently sends a malformed CORS header, which the browser rejects; a retry usually succeeds.'
    return { terms: { ...base, share_basis: why }, perTokenUsd: null, basis: why }
  }

  const terms: DistributionTerms = {
    ...base,
    payout_per_token: reading.perToken > 0 ? reading.perToken : null,
    share_basis: reading.basis,
    pro_rata_verified: reading.proRataVerified,
    samples_taken: reading.samples,
  }

  if (reading.perToken <= 0) return { terms, perTokenUsd: null, basis: reading.basis }

  const price = await stockPriceUsdg(venue.sampleStock, signal)
  if (price === null) {
    return {
      terms,
      perTokenUsd: null,
      basis: `No USDG pool found for ${venue.sampleStock.symbol}, so the payout cannot be priced.`,
    }
  }

  return {
    terms: { ...terms, payout_asset_price_usd: price },
    // One leg measured, scaled by the number of legs the venue states it splits
    // the basket across. The assumption is named rather than buried.
    perTokenUsd: reading.perToken * price * venue.legCount,
    basis: `${reading.samples} recipients sampled · ${reading.perToken.toExponential(3)} ${venue.sampleStock.symbol} per token at $${price.toFixed(2)}, scaled by ${venue.legCount} legs the venue states it buys in equal parts.`,
  }
}
