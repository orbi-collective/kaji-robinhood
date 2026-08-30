/**
 * Launch-day preflight.
 *
 * Everything that must be true before the crank is allowed to move money,
 * checked against the chain rather than against the config file that claims it.
 *
 *   npm run preflight
 */
import { formatUnits, parseAbi } from 'viem'
import { publicClient } from '../src/lib/client'
import { CHAIN_ID, CHAIN_NAME, RPC_URL } from '../src/lib/chain'
import { readActionGasUsd, readPriceFeed } from '../src/lib/feeds'
import { discoverMarket, isLaunched, readAccountBalance, PONSAJI_TOKEN, verifyPayoutAsset } from '../src/lib/ponsajiToken'

const ok = (s: string) => `  \x1b[32mPASS\x1b[0m  ${s}`
const bad = (s: string) => `  \x1b[31mFAIL\x1b[0m  ${s}`
const warn = (s: string) => `  \x1b[33mNOTE\x1b[0m  ${s}`

async function main() {
  let failures = 0
  console.log('\nSAJI launch preflight\n')

  // 1. Chain
  try {
    const id = await publicClient.getChainId()
    if (id === CHAIN_ID) console.log(ok(`Connected to ${CHAIN_NAME} (${id}) via ${new URL(RPC_URL).host}`))
    else {
      console.log(bad(`RPC reports chain ${id}, expected ${CHAIN_ID}`))
      failures++
    }
  } catch {
    console.log(bad('No chain connection. Nothing else can be checked.'))
    process.exitCode = 1
    return
  }

  // 2. Payout asset — the check that matters most, because paying every holder
  //    in a look-alike is unrecoverable.
  const asset = await verifyPayoutAsset()
  if (asset.ok) {
    console.log(
      ok(
        `Payout asset ${asset.symbol} verified onchain — ${asset.totalSupply?.toLocaleString('en-US', { maximumFractionDigits: 0 })} supply, ${asset.decimals} decimals`,
      ),
    )
  } else {
    for (const p of asset.problems) {
      console.log(bad(p))
      failures++
    }
  }
  for (const c of asset.cautions) console.log(warn(c))

  // 3. The batch sender — deployable before the token exists, so checked here.
  if (!PONSAJI_TOKEN.payrollContract) {
    console.log(warn('No disperser configured. The crank will send one transaction per holder, which works but is slow.'))
    console.log(warn('Deploy it with `npm run deploy:payroll` and set `payrollContract`.'))
  } else {
    const code = await publicClient.getBytecode({ address: PONSAJI_TOKEN.payrollContract })
    if (!code || code === '0x') {
      console.log(bad(`No contract at ${PONSAJI_TOKEN.payrollContract}. The disperser address is wrong.`))
      failures++
    } else {
      // Confirm it is the contract we think it is, not merely *a* contract:
      // an approval to the wrong address is an approval to a stranger.
      const probe = await publicClient
        .readContract({
          address: PONSAJI_TOKEN.payrollContract,
          abi: parseAbi(['function totalOf(uint256[]) pure returns (uint256)']),
          functionName: 'totalOf',
          args: [[1n, 2n, 3n]],
        })
        .catch(() => null)
      if (probe === 6n) console.log(ok(`Disperser answers correctly at ${PONSAJI_TOKEN.payrollContract}`))
      else {
        console.log(bad(`The contract at ${PONSAJI_TOKEN.payrollContract} does not behave like PonsajiPayroll. Do not approve it.`))
        failures++
      }
    }
  }

  // 3. Token configured?
  if (!isLaunched()) {
    console.log(warn('Token address is not set. The app stays in pre-launch and the crank will not run.'))
    console.log(warn('Set `address` and `payrollAccount` in src/lib/ponsajiToken.ts after deploying.\n'))
    process.exitCode = failures > 0 ? 1 : 0
    return
  }

  // 4. Its market
  const eth = await readPriceFeed('ETH_USD').catch(() => null)
  const market = await discoverMarket(eth?.price ?? null)
  if (!market) {
    console.log(bad('No pool holding liquidity found for the token. The launchpad may not have seeded it yet.'))
    failures++
  } else {
    console.log(ok(`Market found — fee ${(market.feeBps / 100).toFixed(2)}%, launched ${new Date(market.launchedAt).toISOString()}`))
    if (market.priceUsd === null) console.log(warn('Token price is not readable, so USD figures will be blank.'))
    const quoteIsPayout = market.key.quote.toLowerCase() === PONSAJI_TOKEN.payoutAsset.address.toLowerCase()
    if (quoteIsPayout) console.log(ok(`Paired against ${PONSAJI_TOKEN.payoutAsset.symbol} — fees arrive already denominated, no swap needed`))
    else {
      console.log(
        bad(
          `Paired against ${market.key.quote}, but payoutAsset is ${PONSAJI_TOKEN.payoutAsset.symbol}. Either re-pair, or change payoutAsset to match.`,
        ),
      )
      failures++
    }
  }

  // 5. The account
  const account = await readAccountBalance()
  if (!account) {
    console.log(bad(`The payroll account's ${PONSAJI_TOKEN.payoutAsset.symbol} balance could not be read.`))
    failures++
  } else {
    console.log(ok(`Payroll account holds ${account.units.toFixed(4)} ${PONSAJI_TOKEN.payoutAsset.symbol}${account.usd !== null ? ` ($${account.usd.toFixed(2)})` : ''}`))
  }

  // 6. Can the payroll wallet pay for gas?
  if (PONSAJI_TOKEN.payrollAccount) {
    const wei = await publicClient.getBalance({ address: PONSAJI_TOKEN.payrollAccount })
    const gas = await readActionGasUsd(eth?.price ?? null)
    const ethHeld = Number(formatUnits(wei, 18))
    if (wei === 0n) {
      console.log(bad('The payroll wallet holds no ETH. It cannot pay gas to send anything.'))
      failures++
    } else {
      console.log(ok(`Payroll wallet holds ${ethHeld.toFixed(5)} ETH for gas${gas.usd ? ` (~$${gas.usd.toFixed(4)} per payout)` : ''}`))
    }

    // 7. Is the payout asset actually approved to move? ERC-20 transfer needs
    //    no allowance from the owner, but a zero balance means a dead run.
    const bal = await publicClient
      .readContract({
        address: PONSAJI_TOKEN.payoutAsset.address,
        abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
        functionName: 'balanceOf',
        args: [PONSAJI_TOKEN.payrollAccount],
      })
      .catch(() => 0n)
    if (bal === 0n) console.log(warn('The account holds none of the payout asset yet. Runs will hold until fees arrive.'))
  }

  console.log(failures === 0 ? '\n  Ready.\n' : `\n  ${failures} blocking problem${failures > 1 ? 's' : ''}. Do not run the crank.\n`)
  process.exitCode = failures > 0 ? 1 : 0
}

main().catch((e) => {
  console.error('preflight failed:', e.message)
  process.exitCode = 1
})
