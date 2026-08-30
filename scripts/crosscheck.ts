/**
 * Reproduces a settled cycle from raw logs, and checks it against what the
 * recipients were actually paid.
 *
 * Deliberately shares no code with the payroll engine: it re-reads Transfer
 * logs, folds balances itself, measures every block timestamp it uses, and
 * integrates in its own loop. Agreement means a stranger with an RPC can
 * arrive at the same split — which is the only thing that makes "paid for time
 * held" checkable rather than a claim. Disagreement has already caught one real
 * bug, so this runs as part of the rehearsal rather than on demand.
 */
import { createPublicClient, http, parseAbiItem, formatUnits } from 'viem'
import { readFileSync } from 'node:fs'

const client = createPublicClient({ transport: http(process.env.RPC_URL) })
const TOKEN = process.env.PONSAJI_TOKEN_ADDRESS as `0x${string}`
const PAYOUT = process.env.PONSAJI_PAYOUT_ADDRESS as `0x${string}`
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const ZERO = '0x0000000000000000000000000000000000000000'
const BALANCE_OF = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const plan = JSON.parse(readFileSync('payroll/next-run.json', 'utf8'))
const closeAt: number = plan.closedAt

const head = await client.getBlockNumber()
const logs = await client.getLogs({ address: TOKEN, event: TRANSFER, fromBlock: 0n, toBlock: head })
logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!)

// Measured, never interpolated: this is the check, so it may not share the
// engine's shortcuts.
const at = new Map<bigint, number>()
for (const bn of new Set(logs.map((l) => l.blockNumber!))) {
  at.set(bn, Number((await client.getBlock({ blockNumber: bn })).timestamp) * 1000)
}

type Wallet = { balance: bigint; since: number; service: number }
const book = new Map<string, Wallet>()
const read = (a: string): Wallet => book.get(a) ?? { balance: 0n, since: 0, service: 0 }
const minutesSince = (w: Wallet, now: number) => Number(formatUnits(w.balance, 18)) * ((now - w.since) / 60_000)

for (const log of logs) {
  const when = at.get(log.blockNumber!)!
  if (when > closeAt) continue
  const from = (log.args.from as string).toLowerCase()
  const to = (log.args.to as string).toLowerCase()
  const value = log.args.value as bigint
  if (from === to) continue

  if (from !== ZERO) {
    // Any reduction resets the clock: service earned so far is forfeit.
    const w = read(from)
    book.set(from, { balance: w.balance - value, since: when, service: 0 })
  }
  if (to !== ZERO) {
    const w = read(to)
    const service = w.since === 0 ? 0 : w.service + minutesSince(w, when)
    book.set(to, { balance: w.balance + value, since: when, service })
  }
}

const rows = [...book.entries()]
  .map(([wallet, w]) => ({ wallet, service: w.service + minutesSince(w, closeAt) }))
  .filter((r) => r.service > 0)
  .sort((a, b) => a.wallet.localeCompare(b.wallet))

const totalService = rows.reduce((t, r) => t + r.service, 0)
const pot: number = plan.accountUnits

console.log(`total service  reproduced ${totalService.toFixed(4)}  ·  run ${Number(plan.totalService).toFixed(4)}`)
console.log()
console.log('wallet         reproduced       paid onchain        delta')

let worst = 0
for (const r of rows) {
  const expected = (r.service / totalService) * pot
  const raw = (await client.readContract({
    address: PAYOUT,
    abi: BALANCE_OF,
    functionName: 'balanceOf',
    args: [r.wallet as `0x${string}`],
  })) as bigint
  const paid = Number(formatUnits(raw, 18))
  const delta = Math.abs(paid - expected)
  worst = Math.max(worst, delta)
  console.log(`${r.wallet.slice(0, 10)}…  ${expected.toFixed(8).padStart(13)}  ${paid.toFixed(8).padStart(15)}   ${delta.toExponential(2)}`)
}

// A wei is 1e-18; anything at 1e-9 tokens is float noise in this checker, not
// a difference in what was paid.
const TOLERANCE = 1e-9
console.log()
if (worst < TOLERANCE) {
  console.log(`PASS · the run is reproducible from logs (worst delta ${worst.toExponential(2)} tokens)`)
} else {
  console.log(`FAIL · reproduction disagrees with what was paid by ${worst} tokens`)
  process.exit(1)
}
