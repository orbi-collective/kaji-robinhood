import { createPublicClient, http } from 'viem'
import { RPC_URL, robinhoodChain } from './chain'

/**
 * The one read client every adapter shares.
 *
 * It lives on its own so the venue adapters can depend on it without depending
 * on each other. The timeout is deliberate: a hung endpoint must degrade a row
 * to demo data rather than leave the UI pending forever.
 */
export const publicClient = createPublicClient({
  chain: robinhoodChain,
  // This public endpoint intermittently returns a duplicated
  // `Access-Control-Allow-Origin` header, which browsers reject outright. The
  // failure is per-request and transient, so a couple of retries recovers most
  // reads; whatever still fails degrades visibly rather than silently.
  transport: http(RPC_URL, { batch: true, retryCount: 3, retryDelay: 250, timeout: 12_000 }),
})
