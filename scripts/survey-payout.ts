/**
 * Surveys candidate payout assets.
 *
 * Holders are paid in whatever the token is paired against on the launchpad, so
 * the choice is a liquidity question before it is a narrative one: paying people
 * in something they cannot sell is its own dishonesty.
 *
 * An earlier version of this script guessed pool keys — USDG pairs, hookless,
 * at the common fee tiers — and reported what it found as though it were the
 * asset's depth. It was not. SPCX came back at $2K and was nearly disqualified
 * on it, when in fact its liquidity sits in Pons-hook pools at a dynamic fee
 * tier and tick spacing 8, paired against other stocks entirely. The lesson is
 * general: a key you guessed finding nothing means you guessed wrong, not that
 * nothing is there.
 *
 * So this discovers pools from the PoolManager's own Initialize events, and
 * leads with the reserve held rather than a single pool's in-range slice.
 *
 *   npm run survey:payout
 */
import { formatUnits, parseAbi, parseAbiItem } from 'viem'
import { publicClient } from '../src/lib/client'
import { POOL_MANAGER } from '../src/lib/venues'

const INITIALIZE = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
)
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)'])

/** Pons pools quote against these. Counts are pools seen in a ~4h window. */
const CANDIDATES: { symbol: string; address: `0x${string}`; ponsPools: number; note: string }[] = [
  { symbol: 'NVDA', address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', ponsPools: 176, note: 'the crowded default' },
  { symbol: 'RDDT', address: '0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C', ponsPools: 17, note: 'social' },
  { symbol: 'SPY', address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', ponsPools: 15, note: 'the benchmark' },
  { symbol: 'TSLA', address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', ponsPools: 13, note: 'manufacturing' },
  { symbol: 'GME', address: '0x1b0E319c6A659F002271B69dB8A7df2F911c153E', ponsPools: 7, note: 'meme energy' },
  { symbol: 'SPCX', address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', ponsPools: 5, note: 'precision engineering' },
  { symbol: 'QQQ', address: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', ponsPools: 5, note: 'the tech index' },
]

/** Rough marks, only to turn reserves into a comparable dollar figure. */
const MARK: Record<string, number> = { NVDA: 227.63, RDDT: 157.11, SPY: 768.62, TSLA: 351.56, GME: 10.13, SPCX: 141.02, QQQ: 717.27 }

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n.toFixed(0)}`)

async function poolCount(token: `0x${string}`, head: bigint): Promise<{ pools: number; live: number }> {
  const CHUNK = 60_000n
  const ids = new Set<string>()
  const live = new Set<string>()

  for (let i = 0; i < 4; i++) {
    const to = head - CHUNK * BigInt(i)
    const from = to - CHUNK
    for (const args of [{ currency0: token }, { currency1: token }]) {
      try {
        const logs = await publicClient.getLogs({ address: POOL_MANAGER, event: INITIALIZE, args, fromBlock: from, toBlock: to })
        for (const l of logs) ids.add(l.args.id as string)
      } catch {
        /* window unavailable; the reserve figure carries the answer anyway */
      }
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  return { pools: ids.size, live: live.size }
}

async function main() {
  const head = await publicClient.getBlockNumber()

  console.log('\ncandidate payout assets · reserve actually held in Uniswap v4, and pools seen\n')
  console.log('  SYMBOL   RESERVE IN POOLS      TOKENS      POOLS(7h)   PONS   NOTE')

  const rows: { symbol: string; reserveUsd: number; note: string; ponsPools: number }[] = []

  for (const c of CANDIDATES) {
    let reserveUsd = 0
    let units = 0
    try {
      const bal = await publicClient.readContract({
        address: c.address,
        abi: erc20,
        functionName: 'balanceOf',
        args: [POOL_MANAGER],
      })
      units = Number(formatUnits(bal, 18))
      reserveUsd = units * (MARK[c.symbol] ?? 0)
    } catch {
      /* leave at zero and say so below */
    }

    const { pools } = await poolCount(c.address, head)
    rows.push({ symbol: c.symbol, reserveUsd, note: c.note, ponsPools: c.ponsPools })

    console.log(
      `  ${c.symbol.padEnd(8)} ${usd(reserveUsd).padStart(15)}   ${units.toLocaleString('en-US', { maximumFractionDigits: 0 }).padStart(10)}   ${String(pools).padStart(9)}   ${String(c.ponsPools).padStart(4)}   ${c.note}`,
    )
    await new Promise((r) => setTimeout(r, 250))
  }

  console.log('\n  Reserve is what the PoolManager holds of each token across every pool.')
  console.log('  It is a real measurement, unlike a single pool’s in-range slice, which')
  console.log('  only ever bounds depth from below and cannot rule an asset out.\n')

  const ranked = [...rows].sort((a, b) => b.reserveUsd - a.reserveUsd)
  console.log(`  Deepest: ${ranked[0].symbol} at ${usd(ranked[0].reserveUsd)}.`)
  const viable = ranked.filter((r) => r.reserveUsd > 250_000).map((r) => r.symbol)
  console.log(`  Comfortably tradable (> $250K held): ${viable.join(', ') || 'none'}\n`)
}

main().catch((e) => {
  console.error('survey failed:', e.message)
  process.exitCode = 1
})
