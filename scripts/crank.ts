#!/usr/bin/env node
/**
 * Payroll crank.
 *
 * Run this on a cron. It checks whether the seeded cycle has closed and whether
 * the account covers the cost of paying everyone; when both hold it writes a
 * settlement plan and — only with --execute and a key — sends the payments.
 *
 *   npm run crank            # decide and write a plan, send nothing
 *   npm run crank:execute    # also send, needs PAYROLL_PRIVATE_KEY
 *
 * Cron every ten minutes. The cron is not the schedule: it is how often the
 * question gets asked. The run itself lands on the seeded cycle, which is why
 * a buyer cannot time it — a cron on a published hour would hand the moment
 * straight back to the wallets the service integral exists to exclude.
 *
 * Crontab: every ten minutes, from the repo root, appending to a log.
 * The exact line is in LAUNCH.md — a cron expression cannot be written inside
 * a block comment without closing it.
 *
 * Every decision, taken or declined, is appended to `payroll/runs.jsonl` with
 * the inputs that produced it. That file is the audit trail: anyone holding it
 * can replay a run and check the arithmetic without trusting this process.
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { createPublicClient, createWalletClient, defineChain, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
/** ~0.101s per block on this chain. */
const SECONDS_PER_BLOCK = 0.101

const STATE_FILE = 'payroll/state.json'
const RUNS_FILE = 'payroll/runs.jsonl'
const PLAN_FILE = 'payroll/next-run.json'

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

const client = createPublicClient({ chain, transport: http(RPC, { retryCount: 3, timeout: 20_000 }) })

const log = (...a) => console.log(new Date().toISOString(), ...a)

function loadState() {
  if (!existsSync(STATE_FILE)) return { lastSettledCycle: null }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    // A corrupt state file must not cause a double payment, so this stops
    // rather than assuming nothing has ever been settled.
    throw new Error(`${STATE_FILE} is unreadable. Fix or remove it deliberately before cranking again.`)
  }
}

function record(entry) {
  mkdirSync('payroll', { recursive: true })
  appendFileSync(RUNS_FILE, `${JSON.stringify(entry)}\n`)
}

async function main() {
  const execute = process.argv.includes('--execute')

  // The app and the crank must agree on the arithmetic, so both import it from
  // the same place rather than keeping two copies that can drift apart.
  const { decideCrank } = await import('../src/lib/crank')
  const { computeService, runPayroll } = await import('../src/lib/payroll')
  const { PONSAJI_TOKEN, readBalanceHistory, readAccountBalance } = await import('../src/lib/ponsajiToken')

  if (!PONSAJI_TOKEN.address || !PONSAJI_TOKEN.payrollAccount) {
    log('Token or payroll account not configured. Nothing to crank.')
    return
  }

  const state = loadState()

  const [gasPrice, head] = await Promise.all([client.getGasPrice(), client.getBlockNumber()])

  // The account holds the payout asset, not ETH: the token is paired against it
  // on the launchpad, so creator fees arrive already denominated in it.
  const account = await readAccountBalance()

  // ETH/USD from the same Chainlink feed the app reads.
  const feed = await client
    .readContract({
      address: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9',
      abi: [
        {
          type: 'function',
          name: 'latestRoundData',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
        },
      ],
      functionName: 'latestRoundData',
    })
    .catch(() => null)
  const ethUsd = feed ? Number(feed[1]) / 1e8 : null

  /**
   * The close time comes from the chain, not from this machine.
   *
   * Service is an integral over block timestamps. Closing it at `Date.now()`
   * silently discards every event stamped later than the local clock, so a
   * server running even slightly behind the chain computes less service than
   * people earned — and one running far behind computes none at all and reports
   * "nothing to divide". Caught in rehearsal, where the chain was an hour ahead.
   */
  const headBlock = await client.getBlock({ blockNumber: head })
  const now = Number(headBlock.timestamp) * 1000

  /**
   * Only ever scan back to launch.
   *
   * Service accrues from the moment a wallet last reduced its holding, so the
   * ledger has to reach the launch instant — but never further, and a fixed
   * window does not know that. This ran for eight minutes without output on a
   * rehearsal because it was asking for 800,000 blocks of history on a token
   * minutes old.
   *
   * It does mean the scan lengthens as the token ages. Before that becomes a
   * problem the crank needs to persist its fold and advance it incrementally;
   * a full replay stays possible either way, which is what `verify:ledger`
   * does and what makes a run checkable by a stranger.
   */
  const launchedAt = PONSAJI_TOKEN.launchedAt ?? now
  const sinceLaunchSeconds = Math.max(0, (now - launchedAt) / 1000)
  const span = BigInt(Math.min(2_000_000, Math.ceil(sinceLaunchSeconds / SECONDS_PER_BLOCK) + 2_000))

  const events = await readBalanceHistory(head > span ? head - span : 0n, head)
  if (events === null) {
    log('HOLD · the ledger could not be read in full, so nothing is divided on partial history.')
    record({ at: now, settled: false, reason: 'ledger unreadable' })
    return
  }

  const records = computeService(events, now)
  const eligible = records.filter((r) => r.balance > 0 && r.service > 0)

  const decision = decideCrank({
    launchedAt,
    now,
    accountUsd: account?.usd ?? null,
    walletCount: eligible.length,
    gasPriceWei: gasPrice,
    ethUsd,
    lastSettledCycle: state.lastSettledCycle,
  })

  log(decision.shouldSettle ? 'SETTLE' : 'HOLD', '·', decision.reason)

  if (!decision.shouldSettle) {
    record({ at: now, settled: false, ...decision })
    return
  }

  // Narrowed by the decision itself: a settle verdict cannot carry a null account.
  const accountUsd = decision.accountUsd!
  const run = runPayroll({
    records,
    accountUsd,
    closedAt: now,
    minimumBalance: PONSAJI_TOKEN.minimumBalance,
  })

  // The plan is written before anything is sent, so a failure mid-send leaves
  // a record of exactly what was intended.
  mkdirSync('payroll', { recursive: true })
  writeFileSync(
    PLAN_FILE,
    JSON.stringify(
      {
        cycleIndex: decision.cycleIndex,
        closedAt: now,
        accountUsd,
        payoutAsset: PONSAJI_TOKEN.payoutAsset.symbol,
        accountUnits: account?.units ?? null,
        assetPriceUsd: account?.assetPriceUsd ?? null,
        totalService: run.totalService,
        settlementCostUsd: decision.settlementCostUsd,
        // Whether every event's time was measured or some were estimated
        // between anchors. A reader reproducing this run should know which.
        timestampsExact: events.timestampsExact,
        payouts: run.records.map((r) => ({
          wallet: r.wallet,
          share: r.share,
          usd: r.payoutUsd,
          // Paid in the asset itself; the share is what is authoritative, and
          // the units follow from the account's balance at the close.
          units: (account?.units ?? 0) * r.share,
          service: r.service,
          minutesHeld: r.minutesHeld,
        })),
      },
      null,
      2,
    ),
  )
  log(
    `Plan written: ${run.records.length} wallets, ${(account?.units ?? 0).toFixed(4)} ${PONSAJI_TOKEN.payoutAsset.symbol} ($${accountUsd.toFixed(2)}) to divide.`,
  )

  if (!execute) {
    log('Dry run. Pass --execute to send.')
    return
  }

  const key = process.env.PAYROLL_PRIVATE_KEY
  if (!key) {
    log('PAYROLL_PRIVATE_KEY is not set. Nothing sent.')
    return
  }

  const signer = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
  if (signer.address.toLowerCase() !== PONSAJI_TOKEN.payrollAccount.toLowerCase()) {
    throw new Error(
      `The key is for ${signer.address} but payroll is paid from ${PONSAJI_TOKEN.payrollAccount}. Refusing to send.`,
    )
  }

  const wallet = createWalletClient({ account: signer, chain, transport: http(RPC) })
  const asset = PONSAJI_TOKEN.payoutAsset

  const erc20Abi = [
    {
      type: 'function',
      name: 'transfer',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ type: 'bool' }],
    },
    {
      type: 'function',
      name: 'approve',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ type: 'bool' }],
    },
    {
      type: 'function',
      name: 'allowance',
      stateMutability: 'view',
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      outputs: [{ type: 'uint256' }],
    },
  ] as const

  const payrollAbi = [
    {
      type: 'function',
      name: 'disperse',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'token', type: 'address' },
        { name: 'recipients', type: 'address[]' },
        { name: 'amounts', type: 'uint256[]' },
      ],
      outputs: [],
    },
  ] as const

  // Amounts are fixed once, so the approval, the batches and the record all
  // describe the same numbers.
  const legs = run.records
    .map((r) => ({
      wallet: r.wallet,
      usd: r.payoutUsd,
      units: (account?.units ?? 0) * r.share,
    }))
    .filter((l) => l.units > 0)
    .map((l) => ({ ...l, raw: parseUnits(l.units.toFixed(asset.decimals), asset.decimals) }))
    .filter((l) => l.raw > 0n)

  const sent: { wallet: string; hash: string; units: number; usd: number }[] = []
  let failed = 0

  if (PONSAJI_TOKEN.payrollContract) {
    const disperser = PONSAJI_TOKEN.payrollContract
    const total = legs.reduce((s, l) => s + l.raw, 0n)

    // Approve exactly this run and nothing more. A standing allowance on an
    // unaudited contract is a risk that outlives the run that needed it.
    const current = await client.readContract({
      address: asset.address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [signer.address, disperser],
    })
    if (current < total) {
      log(`Approving ${asset.symbol} ${total} to the disperser…`)
      const h = await wallet.writeContract({
        address: asset.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [disperser, total],
      })
      await client.waitForTransactionReceipt({ hash: h })
    }

    const size = PONSAJI_TOKEN.batchSize
    for (let i = 0; i < legs.length; i += size) {
      const batch = legs.slice(i, i + size)
      try {
        const hash = await wallet.writeContract({
          address: disperser,
          abi: payrollAbi,
          functionName: 'disperse',
          args: [asset.address, batch.map((b) => b.wallet), batch.map((b) => b.raw)],
        })
        await client.waitForTransactionReceipt({ hash })
        for (const b of batch) sent.push({ wallet: b.wallet, hash, units: b.units, usd: b.usd })
        log(`  batch ${i / size + 1}: ${batch.length} paid in one transaction`)
      } catch (e) {
        // The contract reverts the whole batch on one bad leg, which is the
        // right default — but it means the batch has to be unpicked to find
        // which recipient is refusing, so this falls back to individual sends.
        log(`  batch ${i / size + 1} reverted, falling back to individual sends`)
        for (const b of batch) {
          try {
            const hash = await wallet.writeContract({
              address: asset.address,
              abi: erc20Abi,
              functionName: 'transfer',
              args: [b.wallet, b.raw],
            })
            sent.push({ wallet: b.wallet, hash, units: b.units, usd: b.usd })
          } catch (err) {
            failed += 1
            log(`    refused ${b.wallet}: ${String((err as Error).message).split('\n')[0].slice(0, 70)}`)
          }
        }
        void e
      }
    }
  } else {
    log('No disperser configured — sending one transaction per holder.')
    for (const l of legs) {
      try {
        const hash = await wallet.writeContract({
          address: asset.address,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [l.wallet, l.raw],
        })
        sent.push({ wallet: l.wallet, hash, units: l.units, usd: l.usd })
      } catch (e) {
        failed += 1
        log(`  failed ${l.wallet}: ${String((e as Error).message).split('\n')[0].slice(0, 80)}`)
      }
    }
  }

  // State advances only after the sends, so a crash before this point retries
  // the same cycle rather than skipping it.
  writeFileSync(STATE_FILE, JSON.stringify({ lastSettledCycle: decision.cycleIndex, at: now }, null, 2))
  record({ at: now, settled: true, cycleIndex: decision.cycleIndex, accountUsd, paid: sent.length, failed, sent })
  log(`Settled cycle ${decision.cycleIndex}: ${sent.length} paid, ${failed} failed.`)
}

main().catch((e) => {
  log('CRANK FAILED:', e.message)
  process.exitCode = 1
})
