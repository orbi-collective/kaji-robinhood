import type { RiskMode } from './types'

/**
 * The fee-distribution venues PONSAJI prices.
 *
 * Every address here is taken from the project's own published documentation
 * and re-checked onchain before it is used. Nothing is discovered by name
 * lookup: this chain carries look-alike tokens, and a distribution figure
 * attached to the wrong contract would be worse than no figure.
 *
 * Sources:
 * - The Index:  theindex.finance/#/docs — contract table
 * - Quotrons:   quotrons.cash/docs — live contracts table
 */

/** Uniswap v4 singleton the distribution pools settle through. */
export const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951' as `0x${string}`

/** Native ETH is currency zero in v4, not WETH. */
export const NATIVE_ETH = '0x0000000000000000000000000000000000000000' as `0x${string}`

export type StockToken = {
  symbol: string
  name: string
  address: `0x${string}`
  decimals: number
}

/**
 * The Index's supported basket. Prices for each come from its own hookless
 * USDG pool — verified at 0.30% / tick spacing 60 for every one sampled.
 */
export const INDEX_STOCKS: StockToken[] = [
  { symbol: 'AAPL', name: 'Apple', address: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', decimals: 18 },
  { symbol: 'AMD', name: 'AMD', address: '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc', decimals: 18 },
  { symbol: 'AMZN', name: 'Amazon', address: '0x12f190a9f9d7d37a250758b26824b97ce941bf54', decimals: 18 },
  { symbol: 'BE', name: 'Bloom Energy', address: '0x822cc93ffd030293e9842c30bbd678f530701867', decimals: 18 },
  { symbol: 'COIN', name: 'Coinbase', address: '0x6330d8c3178a418788df01a47479c0ce7ccf450b', decimals: 18 },
  { symbol: 'CRWV', name: 'CoreWeave', address: '0x5f10a1c971b69e47e059e1dc91901b59b3fb49c3', decimals: 18 },
  { symbol: 'GOOGL', name: 'Alphabet Class A', address: '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', decimals: 18 },
  { symbol: 'INTC', name: 'Intel', address: '0xc72b96e0e48ecd4dc75e1e45396e26300bc39681', decimals: 18 },
  { symbol: 'META', name: 'Meta Platforms', address: '0xc0d6457c16cc70d6790dd43521c899c87ce02f35', decimals: 18 },
  { symbol: 'MSFT', name: 'Microsoft', address: '0xe93237c50d904957cf27e7b1133b510c669c2e74', decimals: 18 },
  { symbol: 'MU', name: 'Micron Technology', address: '0xff080c8ce2e5feadaca0da81314ae59d232d4afd', decimals: 18 },
  { symbol: 'NVDA', name: 'NVIDIA', address: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', decimals: 18 },
  { symbol: 'ORCL', name: 'Oracle', address: '0xb0992820e760d836549ba69bc7598b4af75dee03', decimals: 18 },
  { symbol: 'PLTR', name: 'Palantir Technologies', address: '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', decimals: 18 },
  { symbol: 'SNDK', name: 'Sandisk', address: '0xb90a19ff0af67f7779aff50a882a9cff42446400', decimals: 18 },
  { symbol: 'SPCX', name: 'SpaceX', address: '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', decimals: 18 },
  { symbol: 'TSLA', name: 'Tesla', address: '0x322f0929c4625ed5bad873c95208d54e1c003b2d', decimals: 18 },
  { symbol: 'USAR', name: 'USA Rare Earth', address: '0xd917b029c761d264c6a312bbbcda868658ef86a6', decimals: 18 },
]

export type DistributionVenue = {
  id: string
  name: string
  subtitle: string
  curator: string
  /** Matches the mandate's protocol allowlist. */
  venueKey: string
  profile: RiskMode
  token: { address: `0x${string}`; symbol: string; decimals: number }
  /** Asset the position is entered and exited in. */
  quoteAsset: string
  feeHook: `0x${string}` | null
  /**
   * Where the round-trip fee is actually readable.
   *
   * These venues charge in three different places, and guessing wrong means
   * quoting a fee the trader will not pay:
   *  `hook`      — a hook contract exposes it (The Index)
   *  `quoter`    — a view quoter reports it per payer (Quotrons)
   *  `poolTier`  — the tax *is* the pool's own v4 fee tier (HOOD10)
   */
  feeSource: 'hook' | 'quoter' | 'poolTier'
  /**
   * Whether holding the token alone earns anything.
   *
   * Structural, and separate from `distributor`: a venue can pay its holders
   * while PONSAJI has no way to measure what they receive. Collapsing the two
   * would let an unmeasurable venue render as "pays nothing", which is a
   * different and much more damaging claim.
   */
  paysHolders: boolean
  /** Set only when the payout is actually measurable. */
  distributor: `0x${string}` | null
  /** Pool key hint, when it has been discovered and confirmed. */
  poolHint: { quote: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` } | null
  /** Published pool id, for venues that document it instead of their key. */
  poolId: `0x${string}` | null
  /** What holders are paid in. */
  paidIn: string[]
  /** Representative payout leg PONSAJI measures a cycle from. */
  sampleStock: StockToken | null
  /** Legs the basket is split across, per the venue's own documentation. */
  legCount: number
  docsUrl: string
}

const INDEX_HOOK = '0x2cD91bD228ff4c537031d6b8204782090c84c0cC' as `0x${string}`

export const DISTRIBUTION_VENUES: DistributionVenue[] = [
  {
    id: 'index-ledger',
    name: 'Index Ledger',
    subtitle: 'The Index · $INDEX',
    curator: 'The Index',
    venueKey: 'the-index',
    profile: 'opportunistic',
    token: { address: '0x56910D4409F3a0C78C64DD8D0545FF0705389870', symbol: 'INDEX', decimals: 18 },
    quoteAsset: 'ETH',
    feeHook: INDEX_HOOK,
    feeSource: 'hook',
    paysHolders: true,
    distributor: '0x39ADB8acD07427D338b5f1AfAb436A04AbFdB7c4',
    // Confirmed onchain: native ETH quote, 1% tier, tick spacing 200, hook attached.
    poolHint: { quote: NATIVE_ETH, fee: 10000, tickSpacing: 200, hooks: INDEX_HOOK },
    poolId: null,
    paidIn: INDEX_STOCKS.map((s) => s.symbol),
    sampleStock: INDEX_STOCKS.find((s) => s.symbol === 'NVDA') ?? null,
    legCount: INDEX_STOCKS.length,
    docsUrl: 'https://theindex.finance/#/docs',
  },
  {
    id: 'quotron-terminal',
    name: 'Quotron Terminal',
    subtitle: 'Quotrons · $QUOTRON',
    curator: 'Mavrk',
    venueKey: 'quotrons',
    profile: 'opportunistic',
    token: { address: '0x5a86828Efd322bfb16d93cFeD16EE9BC14940D7F', symbol: 'QUOTRON', decimals: 18 },
    quoteAsset: 'ETH',
    feeHook: '0x6200000000000000000000000000000000000000',
    feeSource: 'quoter',
    // Rewards accrue to hardwired terminals — NFTs made by burning the token.
    paysHolders: false,
    // Quotrons pays hardwired terminals, not plain token holders, so there is
    // no per-token distribution to measure the way The Index has one.
    distributor: null,
    poolHint: null,
    // Quotrons publishes the canonical pool id rather than the key's fee tier
    // and tick spacing, so depth is read from the id directly.
    poolId: '0x0b142aaf734f1b063355bfe854e282a13b26dcac86e2e564e74540f9b218d069',
    paidIn: ['NVDA', 'AAPL', 'TSLA', 'GME', 'SPCX', 'SPY', 'PLTR', 'NFLX', 'RDDT', 'MSTR'],
    sampleStock: null,
    legCount: 10,
    docsUrl: 'https://quotrons.cash/docs',
  },
  {
    id: 'hood-ten',
    name: 'Hood Ten',
    subtitle: 'HOOD10 · Robinhood10 Index',
    curator: 'HOOD10',
    venueKey: 'hood10',
    profile: 'opportunistic',
    token: { address: '0x0D257cA40d40090BE60C2d2Ed5bB3535392838cc', symbol: 'HOOD10', decimals: 18 },
    quoteAsset: 'ETH',
    feeHook: null,
    feeSource: 'poolTier',
    // It does pay holders; PONSAJI simply cannot measure what they get, because
    // the site publishes the distributor only as `0x9f3edbfA…6210`.
    paysHolders: true,
    distributor: null,
    poolHint: { quote: NATIVE_ETH, fee: 50000, tickSpacing: 500, hooks: NATIVE_ETH },
    poolId: null,
    paidIn: ['Top 10 by pool liquidity, re-read each epoch'],
    sampleStock: null,
    legCount: 10,
    docsUrl: 'https://www.hood10.xyz/docs',
  },
]

/**
 * HOOD10 — a third shape again.
 *
 * Its tax is not charged by a hook at all: the canonical pool is hookless and
 * its v4 fee tier *is* the 5% tax, which makes the round trip readable from
 * the pool key rather than taken on trust from the documentation. Confirmed by
 * scanning the PoolManager's Initialize events — of five HOOD10 pools, the
 * USDG ones are empty and this native-ETH pool holds the liquidity.
 *
 * PONSAJI carries no payout measurement for it: the site truncates its
 * distributor address and its contracts are unverified on Blockscout, so what
 * a holder earns cannot be read. The cost side is measured; the income side
 * says so.
 */
export const QUOTRON_QUOTER = '0xb8960fdC8A0Be155d196C2795b75747763562df2' as `0x${string}`
