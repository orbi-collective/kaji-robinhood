import { formatUnits } from 'viem'
import { erc4626Abi } from './abi'
import { IS_LIVE_CHAIN, MORPHO, PRICE_FEEDS, VAULTS, robinhoodChain } from './chain'
import { publicClient } from './client'
import { readPriceFeed } from './feeds'
export { readPriceFeed, type FeedReading } from './feeds'
import { fetchDistributionOpportunities } from './distribution'
import { netCarry } from './policy'
import type { CarryBreakdown, DataSource, Opportunity } from './types'

/**
 * Venue adapters.
 *
 * PONSAJI prices two classes of position against one another: ERC-4626 vaults,
 * where capital compounds, and fee-distribution tokens, where capital buys a
 * share of somebody else's trading volume. They are only comparable once every
 * cost is subtracted, which is why they share a scanner and an engine.
 *
 * Onchain state is the source of truth throughout. Where a number cannot be
 * read, the row degrades and is labelled rather than filled in.
 */

export { publicClient }

export class AdapterError extends Error {
  venue: string

  constructor(message: string, venue: string) {
    super(message)
    this.name = 'AdapterError'
    this.venue = venue
  }
}

/* ------------------------------------------------------------------ */
/* Reference book — used only when a live read fails, always labelled  */
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

/** Annualised gas, assuming one entry and one exit at roughly $0.02 per action. */
const ANNUAL_GAS_USD = 0.04

/**
 * Risk score, 0–100, derived from observable vault properties rather than
 * assigned by hand. Two things dominate whether a depositor can actually get
 * out: how much of the vault is liquid right now, and how deep it is overall.
 */
function deriveRiskScore(input: { tvlUsd: number | null; liquidityUsd: number | null; netApy: number }): number {
  const tvl = input.tvlUsd ?? 0
  const liquidity = input.liquidityUsd ?? 0
  const liquidRatio = tvl > 0 ? Math.min(1, liquidity / tvl) : 0

  // Thin liquidity is the biggest exit risk.
  const liquidityRisk = (1 - liquidRatio) * 45
  // Small vaults concentrate depositor and curator risk.
  const depthRisk = tvl >= 100_000_000 ? 4 : tvl >= 10_000_000 ? 12 : tvl >= 1_000_000 ? 24 : 38
  // Yield materially above the stablecoin norm is being paid for something.
  const yieldRisk = Math.max(0, Math.min(20, (input.netApy - 0.03) * 260))

  return Math.max(1, Math.min(100, Math.round(liquidityRisk + depthRisk + yieldRisk)))
}

/* ------------------------------------------------------------------ */
/* Onchain reads                                                       */
/* ------------------------------------------------------------------ */

export type VaultState = {
  address: `0x${string}`
  name: string
  asset: `0x${string}`
  totalAssets: bigint
  assetDecimals: number
  totalAssetsUsd: number
}

/** Reads a vault's live state. Throws if the RPC or contract is unreachable. */
export async function readVaultState(vault: (typeof VAULTS)[number]): Promise<VaultState> {
  const [asset, totalAssets, name] = await Promise.all([
    publicClient.readContract({ address: vault.address, abi: erc4626Abi, functionName: 'asset' }),
    publicClient.readContract({ address: vault.address, abi: erc4626Abi, functionName: 'totalAssets' }),
    publicClient.readContract({ address: vault.address, abi: erc4626Abi, functionName: 'name' }),
  ])

  return {
    address: vault.address,
    name,
    asset,
    totalAssets,
    assetDecimals: vault.asset.decimals,
    totalAssetsUsd: Number(formatUnits(totalAssets, vault.asset.decimals)),
  }
}


/**
 * Integrity guard. Confirms the configured vault really is an ERC-4626 over the
 * asset we think it is, so a mistyped override or a look-alike token surfaces as
 * a blocked deployment instead of a lost deposit.
 */
export type DeploymentCheck = { ok: boolean; problems: string[] }

export async function verifyDeployment(): Promise<DeploymentCheck> {
  const problems: string[] = []
  for (const vault of VAULTS) {
    try {
      const state = await readVaultState(vault)
      if (state.asset.toLowerCase() !== vault.asset.address.toLowerCase()) {
        problems.push(
          `${vault.name}: vault reports underlying ${state.asset}, expected ${vault.asset.address}. Deposits blocked.`,
        )
      }
    } catch (e) {
      problems.push(`${vault.name}: could not read vault state (${e instanceof Error ? e.message : 'unknown error'}).`)
    }
  }
  return { ok: problems.length === 0, problems }
}

/* ------------------------------------------------------------------ */
/* Forward APY (Morpho public API, best-effort)                        */
/* ------------------------------------------------------------------ */

type ApyReading = {
  netApy: number
  grossApy: number
  fee: number
  liquidityUsd: number | null
  tvlUsd: number | null
  name: string | null
}

/**
 * The curated USDG vaults on this chain are Morpho Vault V2s, so the yield comes
 * from `vaultV2s` — the V1 `vaults` collection does not contain them.
 */
const VAULT_QUERY = `query VaultsV2($chainId: Int!) {
  vaultV2s(where: { chainId_in: [$chainId] }, first: 100) {
    items {
      address
      name
      apy
      netApy
      totalAssetsUsd
      liquidityUsd
      performanceFee
      managementFee
    }
  }
}`

async function fetchApys(signal?: AbortSignal): Promise<Map<string, ApyReading>> {
  const out = new Map<string, ApyReading>()
  try {
    const res = await fetch(MORPHO.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: VAULT_QUERY, variables: { chainId: robinhoodChain.id } }),
      signal: signal ?? AbortSignal.timeout(10_000),
    })
    if (!res.ok) return out

    const json: unknown = await res.json()
    const items = (json as { data?: { vaultV2s?: { items?: unknown[] } } })?.data?.vaultV2s?.items
    if (!Array.isArray(items)) return out

    for (const raw of items) {
      const item = raw as {
        address?: string
        name?: string
        apy?: number
        netApy?: number
        totalAssetsUsd?: number
        liquidityUsd?: number
        performanceFee?: number
        managementFee?: number
      }
      const netApy = item.netApy
      if (!item.address || typeof netApy !== 'number' || !Number.isFinite(netApy)) continue
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
      out.set(item.address.toLowerCase(), {
        netApy,
        grossApy: num(item.apy) ?? netApy,
        fee: (num(item.performanceFee) ?? 0) + (num(item.managementFee) ?? 0),
        liquidityUsd: num(item.liquidityUsd),
        tvlUsd: num(item.totalAssetsUsd),
        name: item.name ?? null,
      })
    }
  } catch {
    // Network, CORS or shape mismatch — callers fall back to reference data.
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

function buildOpportunity(
  vault: (typeof VAULTS)[number],
  opts: {
    source: DataSource
    breakdown: CarryBreakdown
    exitLiquidityUsd: number
    oracleAgeSeconds: number
    heartbeatSeconds: number
    riskScore: number
    tvlUsd: number | null
    /** Set when a source was missing, so the UI can say which one. */
    unavailable?: string
  },
): Opportunity {
  const b = opts.breakdown
  return {
    recipe_id: vault.id,
    kind: 'vault',
    name: vault.name,
    subtitle: vault.subtitle,
    profile: vault.profile,
    inputs: { base_asset: vault.asset.symbol, venue: 'morpho', hedge_venue: null },
    ingredients: [{ label: vault.asset.symbol, venue: 'morpho', weight: 100 }],
    breakdown: b,
    gross_apy: b.lending_yield + b.funding_income + b.incentive_value,
    estimated_net_carry: netCarry(b),
    risk_score: opts.riskScore,
    exit_liquidity_usd: opts.exitLiquidityUsd,
    oracle_age_seconds: opts.oracleAgeSeconds,
    oracle_heartbeat_seconds: opts.heartbeatSeconds,
    tvl_usd: opts.tvlUsd,
    curator: vault.curator,
    contract_address: vault.address,
    distribution: null,
    unavailable_reason: opts.unavailable ?? null,
    requires_leverage: false,
    source: opts.source,
    as_of: Date.now(),
  }
}

/**
 * Fetch ranked opportunities. Ranking is net carry per unit of risk, so a higher
 * headline APY never outranks a cleaner one by itself.
 */
export async function fetchOpportunities(signal?: AbortSignal): Promise<Opportunity[]> {
  const heartbeatOf = (v: (typeof VAULTS)[number]) => PRICE_FEEDS[v.priceFeedKey].heartbeatSeconds

  if (!IS_LIVE_CHAIN) {
    return VAULTS.map((vault) =>
      buildOpportunity(vault, {
        source: 'demo',
        breakdown: EMPTY_BREAKDOWN,
        exitLiquidityUsd: 0,
        oracleAgeSeconds: 0,
        heartbeatSeconds: heartbeatOf(vault),
        riskScore: 50,
        tvlUsd: null,
      }),
    )
  }

  // One API round-trip and one feed read serve every vault.
  const [apys, feed] = await Promise.all([
    fetchApys(signal),
    readPriceFeed('USDG_USD').catch(() => null),
  ])

  const results = await Promise.all(
    VAULTS.map(async (vault) => {
      const heartbeat = feed?.heartbeatSeconds ?? heartbeatOf(vault)
      const apy = apys.get(vault.address.toLowerCase())

      // The vault's own contract is the authority on TVL and on which asset it
      // holds; the API only supplies forward yield.
      const state = await readVaultState(vault).catch(() => null)

      if (!apy || !state) {
        return buildOpportunity(vault, {
          source: 'demo',
          breakdown: EMPTY_BREAKDOWN,
          exitLiquidityUsd: state?.totalAssetsUsd ?? 0,
          oracleAgeSeconds: feed?.ageSeconds ?? 0,
          heartbeatSeconds: heartbeat,
          riskScore: 50,
          tvlUsd: state?.totalAssetsUsd ?? null,
          unavailable: !apy ? 'yield feed unavailable' : 'vault read failed',
        })
      }

      const gasDrag = vault.asset.decimals && state.totalAssetsUsd > 0 ? ANNUAL_GAS_USD / 10_000 : 0
      const breakdown: CarryBreakdown = {
        lending_yield: apy.grossApy,
        funding_income: 0,
        incentive_value: 0,
        borrow_cost: 0,
        hedge_cost: 0,
        // netApy is already net of curator fees; carry the difference explicitly
        // so the itemised breakdown reconciles to the figure the vault reports.
        protocol_fees: Math.max(0, apy.grossApy - apy.netApy),
        estimated_slippage: 0,
        annualized_gas_cost: gasDrag,
      }

      return buildOpportunity(vault, {
        source: 'live',
        breakdown,
        exitLiquidityUsd: apy.liquidityUsd ?? state.totalAssetsUsd,
        oracleAgeSeconds: feed?.ageSeconds ?? 0,
        heartbeatSeconds: heartbeat,
        riskScore: deriveRiskScore({
          tvlUsd: apy.tvlUsd ?? state.totalAssetsUsd,
          liquidityUsd: apy.liquidityUsd,
          netApy: apy.netApy,
        }),
        tvlUsd: apy.tvlUsd ?? state.totalAssetsUsd,
      })
    }),
  )

  // Both venue classes rank on one axis. A distribution row has no carry rate
  // to speak of, so it sorts last on this measure — which is the honest
  // outcome, not a bug: its return has to be earned back before it is a return.
  const distribution = await fetchDistributionOpportunities(signal).catch(() => [])

  return [...results, ...distribution].sort(
    (a, b) => b.estimated_net_carry / (b.risk_score || 1) - a.estimated_net_carry / (a.risk_score || 1),
  )
}

export async function fetchOpportunity(id: string, signal?: AbortSignal): Promise<Opportunity | null> {
  const all = await fetchOpportunities(signal)
  return all.find((o) => o.recipe_id === id) ?? null
}

/* ------------------------------------------------------------------ */
/* Owner positions — what a wallet actually holds, read from chain     */
/* ------------------------------------------------------------------ */

export type OwnerPosition = {
  recipe_id: string
  recipe_name: string
  subtitle: string
  vault_address: `0x${string}`
  /** Vault shares held by the owner. */
  shares: bigint
  /** Those shares valued in the vault's underlying asset. */
  assets: bigint
  assetSymbol: string
  assetDecimals: number
  valueUsd: number
  /**
   * The vault's own `maxWithdraw` answer for this owner, or `null` when the
   * call reverts. Not a liquidity guarantee: the Vault V2 deployments PONSAJI
   * reads return 0 for every holder, so a zero here means "the contract does
   * not expose an instant exit for this wallet", not "the money is gone". Exit
   * depth on the scanner comes from a different source and is labelled as such.
   */
  maxWithdrawUsd: number | null
}

/**
 * Reads a wallet's real vault holdings.
 *
 * The local event log records what this browser did; this reads what the chain
 * says the wallet owns. A deposit made from another device — or directly on
 * Morpho — belongs on the vault page just as much as one made here, so the
 * chain is the authority and local state only supplies the narrative.
 */
export async function readOwnerPositions(owner: `0x${string}`): Promise<OwnerPosition[]> {
  if (!IS_LIVE_CHAIN) return []

  const results = await Promise.all(
    VAULTS.map(async (vault): Promise<OwnerPosition | null> => {
      try {
        const shares = await publicClient.readContract({
          address: vault.address,
          abi: erc4626Abi,
          functionName: 'balanceOf',
          args: [owner],
        })
        if (shares === 0n) return null

        const [assets, maxWithdraw] = await Promise.all([
          publicClient.readContract({
            address: vault.address,
            abi: erc4626Abi,
            functionName: 'convertToAssets',
            args: [shares],
          }),
          // A revert here is "unknown", not "zero" — the two must not collapse
          // into the same number on screen.
          publicClient
            .readContract({ address: vault.address, abi: erc4626Abi, functionName: 'maxWithdraw', args: [owner] })
            .catch(() => null),
        ])

        const toUsd = (v: bigint) => Number(formatUnits(v, vault.asset.decimals))
        return {
          recipe_id: vault.id,
          recipe_name: vault.name,
          subtitle: vault.subtitle,
          vault_address: vault.address,
          shares,
          assets,
          assetSymbol: vault.asset.symbol,
          assetDecimals: vault.asset.decimals,
          valueUsd: toUsd(assets),
          maxWithdrawUsd: maxWithdraw === null ? null : toUsd(maxWithdraw),
        }
      } catch {
        // One unreachable vault must not blank the whole page.
        return null
      }
    }),
  )

  return results.filter((p): p is OwnerPosition => p !== null)
}
