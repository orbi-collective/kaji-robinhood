/**
 * Proves the ledger rebuild works against a real, busy token before launch day.
 *
 * `readBalanceHistory` is the most failure-prone thing in the payroll path: the
 * only part that must read a lot of history from an endpoint that refuses any
 * query matching more than 10,000 logs. Our own token cannot be tested before
 * it exists, so this exercises **the shipped function itself** against a token
 * with comparable traffic — a rehearsal that reimplemented the logic would
 * prove nothing about the code that actually runs.
 *
 *   npm run verify:ledger
 */
import { computeService, runPayroll } from '../src/lib/payroll'
import { readBalanceHistory } from '../src/lib/ponsajiToken'
import { publicClient } from '../src/lib/client'

const SECONDS_PER_BLOCK = 0.101

/** SPCX — the payout asset, and busy enough to be a fair rehearsal. */
const TOKEN = '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa' as `0x${string}`

async function main() {
  const head = await publicClient.getBlockNumber()
  // One cycle's worth of history: the window a real run replays.
  const span = BigInt(Math.round((75 * 60) / SECONDS_PER_BLOCK))
  const from = head - span

  console.log(`\nrehearsing readBalanceHistory over ${span} blocks (~75 min) on a live token\n`)

  const t0 = Date.now()
  const events = await readBalanceHistory(from, head, undefined, TOKEN)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  if (events === null) {
    console.log(`  FAILED after ${elapsed}s — the scan could not complete even at its narrowest window.`)
    console.log('  The reader returns nothing rather than paying on a partial ledger, which is correct,')
    console.log('  but it means a run could not settle against this endpoint right now.\n')
    process.exitCode = 1
    return
  }

  console.log(`  ${events.length} balance events rebuilt in ${elapsed}s`)

  const now = Date.now()
  const records = computeService(events, now)
  const run = runPayroll({ records, accountUsd: 1000, closedAt: now })
  const paid = run.records.reduce((s, r) => s + r.payoutUsd, 0)
  const shares = run.records.reduce((s, r) => s + r.share, 0)

  console.log(`  service computed for ${records.length} wallets, ${run.records.length} eligible to be paid`)
  console.log(`  a $1,000 run divides to $${paid.toFixed(2)}, shares summing to ${shares.toFixed(9)}`)
  console.log(
    `  longest service: ${run.records
      .slice(0, 3)
      .map((r) => `${r.wallet.slice(0, 8)}… ${(r.share * 100).toFixed(2)}% over ${r.minutesHeld.toFixed(0)}m`)
      .join('  ')}\n`,
  )

  if (Math.abs(shares - 1) > 1e-9 && run.records.length > 0) {
    console.log('  WARNING: shares do not sum to 1. The division is wrong.\n')
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('rehearsal failed:', e.message)
  process.exitCode = 1
})
