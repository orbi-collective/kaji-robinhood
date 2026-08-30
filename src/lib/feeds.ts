import { aggregatorV3Abi } from './abi'
import { PRICE_FEEDS, type PriceFeedKey } from './chain'
import { publicClient } from './client'

/**
 * Chainlink reads.
 *
 * Separate from the venue adapters so both venue classes can price against the
 * same feeds without importing each other.
 */

export type FeedReading = {
  pair: string
  price: number
  updatedAt: number
  ageSeconds: number
  heartbeatSeconds: number
  stale: boolean
}

/** Reads a feed and reports its age against the publisher's own heartbeat. */
export async function readPriceFeed(key: PriceFeedKey): Promise<FeedReading> {
  const feed = PRICE_FEEDS[key]
  const [, answer, , updatedAt] = await publicClient.readContract({
    address: feed.address,
    abi: aggregatorV3Abi,
    functionName: 'latestRoundData',
  })

  const updated = Number(updatedAt)
  const age = Math.max(0, Math.floor(Date.now() / 1000) - updated)
  return {
    pair: feed.pair,
    price: Number(answer) / 10 ** feed.decimals,
    updatedAt: updated,
    ageSeconds: age,
    heartbeatSeconds: feed.heartbeatSeconds,
    stale: age > feed.heartbeatSeconds,
  }
}

/**
 * Cost of one action, in USD.
 *
 * The gas price is read from the chain; the gas units are an assumption, and a
 * stated one — a swap or an ERC-4626 deposit lands near this figure, and the
 * whole term is worth cents at current prices. Naming which half is measured
 * and which is assumed is the point.
 */
export const ASSUMED_GAS_UNITS = 150_000

export async function readActionGasUsd(ethUsd: number | null): Promise<{ usd: number | null; basis: string }> {
  if (!ethUsd) return { usd: null, basis: 'ETH/USD feed unavailable' }
  try {
    const gasPrice = await publicClient.getGasPrice()
    const eth = (Number(gasPrice) * ASSUMED_GAS_UNITS) / 1e18
    return {
      usd: eth * ethUsd,
      basis: `gasPrice read onchain × ${ASSUMED_GAS_UNITS.toLocaleString('en-US')} assumed units`,
    }
  } catch {
    return { usd: null, basis: 'gas price unreadable' }
  }
}
