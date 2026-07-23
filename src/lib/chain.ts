import { defineChain } from 'viem'
import { http, createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'

/**
 * Robinhood Chain mainnet.
 *
 * Addresses below are the canonical ones published by the issuing projects, not
 * discovered by name lookup — Robinhood's own token page warns that a token with
 * a matching name but a different contract is not the real one, and the chain
 * carries several look-alike "Global Dollar" ERC-20s. `verifyDeployment()` in
 * adapters.ts re-checks the vault's underlying asset onchain before any
 * transaction is prepared, so a bad override cannot reach a wallet.
 *
 * Sources:
 * - Chain params + USDG/WETH: docs.robinhood.com/chain
 * - Morpho core:               docs.morpho.org/get-started/resources/addresses
 * - Steakhouse USDG vault:     app.morpho.org/robinhood-chain/vault
 * - Chainlink feeds:           Chainlink reference-data-directory (feeds-robinhood-mainnet)
 */

const env = import.meta.env

const DEFAULTS = {
  chainId: 4663,
  chainName: 'Robinhood Chain',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
} as const

export const CHAIN_ID = Number(env.VITE_CHAIN_ID ?? DEFAULTS.chainId)
export const CHAIN_NAME = String(env.VITE_CHAIN_NAME ?? DEFAULTS.chainName)
export const RPC_URL = String(env.VITE_RPC_URL ?? DEFAULTS.rpcUrl)
export const EXPLORER_URL = String(env.VITE_EXPLORER_URL ?? DEFAULTS.explorerUrl)

/** Canonical token contracts. */
export const TOKENS = {
  USDG: {
    address: (env.VITE_USDG_ADDRESS ?? '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168') as `0x${string}`,
    symbol: 'USDG',
    decimals: 6,
  },
  WETH: {
    address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as `0x${string}`,
    symbol: 'WETH',
    decimals: 18,
  },
} as const

/** Morpho Blue core deployment on this chain. */
export const MORPHO = {
  core: '0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010' as `0x${string}`,
  adaptiveCurveIrm: '0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1' as `0x${string}`,
  chainlinkOracleFactory: '0xB7c16F6F8cF531447Bf27Ca7220f981E79C9cdF2' as `0x${string}`,
  apiUrl: 'https://blue-api.morpho.org/graphql',
} as const

/**
 * ERC-4626 vaults Kaji can read and deposit into. Each is a real, curated
 * Morpho vault; `asset` is asserted onchain before a deposit is prepared.
 */
export const VAULTS = [
  {
    id: 'steady-press',
    address: (env.VITE_STEAKHOUSE_USDG_VAULT ?? '0xBeEff033F34C046626B8D0A041844C5d1A5409dd') as `0x${string}`,
    name: 'Steady Press',
    subtitle: 'Steakhouse USDG',
    curator: 'Steakhouse Financial',
    profile: 'conservative' as const,
    asset: TOKENS.USDG,
    priceFeedKey: 'USDG_USD' as const,
  },
  {
    id: 'carry-alloy',
    address: (env.VITE_ETHENA_USDG_VAULT ?? '0xbEeFF0fb1Dc19344A87b8479dAb60A2e16160737') as `0x${string}`,
    name: 'Carry Alloy',
    subtitle: 'Ethena × Steakhouse USDG',
    curator: 'Steakhouse Financial',
    profile: 'measured' as const,
    asset: TOKENS.USDG,
    priceFeedKey: 'USDG_USD' as const,
  },
  {
    id: 'neutral-beam',
    address: (env.VITE_PURINTA_USDG_VAULT ?? '0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8') as `0x${string}`,
    name: 'Neutral Beam',
    subtitle: 'Purinta USDG',
    curator: 'Purinta',
    profile: 'opportunistic' as const,
    asset: TOKENS.USDG,
    priceFeedKey: 'USDG_USD' as const,
  },
] as const

/**
 * Chainlink feeds. `heartbeat` is the publisher's own staleness bound — the
 * policy engine uses it rather than an invented constant, so "stale" means what
 * Chainlink says it means.
 */
export const PRICE_FEEDS = {
  USDG_USD: {
    address: '0x61B7e5650328764B076A108EFF5fa7282a1B9aD2' as `0x${string}`,
    decimals: 8,
    heartbeatSeconds: 86_400,
    pair: 'USDG / USD',
  },
  USDC_USD: {
    address: '0x9e6f4605992a899eE2999999F3Ec80C41F452546' as `0x${string}`,
    decimals: 8,
    heartbeatSeconds: 86_400,
    pair: 'USDC / USD',
  },
  ETH_USD: {
    address: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9' as `0x${string}`,
    decimals: 8,
    heartbeatSeconds: 86_400,
    pair: 'ETH / USD',
  },
} as const

export type PriceFeedKey = keyof typeof PRICE_FEEDS

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER_URL } },
})

/** True when this build can read the chain and prepare real transactions. */
export const IS_LIVE_CHAIN = CHAIN_ID > 0 && RPC_URL.startsWith('http') && VAULTS.length > 0

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected()],
  transports: { [robinhoodChain.id]: http(RPC_URL, { batch: true, retryCount: 2, timeout: 12_000 }) },
})

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL.replace(/\/$/, '')}/tx/${hash}`
}

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL.replace(/\/$/, '')}/address/${address}`
}

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
