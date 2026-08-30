# Launch day

Everything below is already built. This is the order to do it in, and the one
file that changes.

## 1. Deploy on the launchpad

**Pair the token against SPCX.** That is the one setting that matters beyond the
name, because holders are paid in whatever the token is paired against — fees
arrive already denominated in it and payroll never has to swap.

Liquidity was checked first. `npm run survey:payout` re-runs this and reports
what the Uniswap v4 PoolManager actually holds of each candidate:

| Pair | Reserve held in pools | Pons pools |
|---|---|---|
| SPY | $2.45M | 15 |
| NVDA | $1.86M | 176 |
| **SPCX** | **$1.46M** | 5 |
| TSLA | $319K | 13 |
| QQQ | $223K | 5 |
| GME | $165K | 7 |
| RDDT | $151K | 17 |

> **Re-run the survey before you deploy.** These move overnight, and an earlier
> version of the script got SPCX badly wrong — it guessed pool keys, found a
> near-empty USDG pool, and reported $2K. SPCX's liquidity is in Pons-hook pools
> at a dynamic fee tier paired against other stocks, nowhere the guess looked.
> The current script discovers pools from Initialize events instead. A key that
> finds nothing means the guess was wrong, not that nothing is there.

Among the tradable options the choice is narrative, and SPCX is the one that
belongs to this machine: precision-built hardware that either holds spec or
aborts, which is the vocabulary the product already speaks. It is also uncommon
— five launchpad pairs against NVDA's 176, and an asset with no ordinary market
to buy it on at all.

Note three things as you go:

| What | Why it matters |
|---|---|
| **Contract address** | The only value the app strictly needs |
| **Creator-fee wallet** | This becomes the payroll account, published on the page |
| **Pair asset** | Must be SPCX, or change `payoutAsset` to match what you actually paired |

Nothing needs to be deployed by us. The payroll account is the launchpad's
creator-fee stream, so there is no contract of ours to audit and no treasury.

## 1b. Deploy the batch sender

```bash
npm run deploy:payroll     # needs PAYROLL_PRIVATE_KEY or --private-key
```

`PonsajiPayroll` pays many wallets in one transaction. Without it the crank falls
back to one transaction per holder, which works but means thousands of
transactions and hours of nonce churn.

It is ~40 lines and deliberately small enough to read in full, because it is
unaudited and it moves money. Three properties, all from one line — every leg is
`transferFrom(msg.sender, ...)`:

- **It can only spend the caller's own allowance.** There is no argument that
  names a different payer, so an approval granted to it is useless to anybody
  else. Tested directly (`test_cannotSpendSomeoneElsesAllowance`).
- **It never holds a balance.** Tokens move payer → recipient, so there is
  nothing to strand or sweep.
- **No owner, no pause, no upgrade, no admin function.** Nothing to trust past
  the code.

A failed leg reverts the whole batch — a partial payroll is worse than a failed
one, and the crank falls back to individual sends to find the refusing wallet.
That matters here because SPCX is pausable and a recipient can become
untransferable without warning.

Measured on a mainnet fork against the real SPCX: **400 recipients in one
transaction, 15,065,686 gas, 37,664 per recipient.** The mock figure is 25,000 —
the difference is SPCX's beacon proxy, and taking the mock number would have
understated every settlement estimate by half.

Then set `payrollContract` in the same config block below.

## 2. Fill in one block

`src/lib/ponsajiToken.ts` — the `PONSAJI_TOKEN` object at the top:

```ts
address:         '0x…',  // the token contract address
payrollAccount:  '0x…',  // the creator-fee wallet
payrollContract: '0x…',  // PonsajiPayroll, from step 1b
launchedAt:      null,   // leave null — read from the pool's own Initialize block
// payoutAsset is already SPCX. Change it only if you paired against something else.
```

That is the whole change. Everything else is discovered from the chain:

- **The pool** — found by scanning the PoolManager's `Initialize` events for the
  token, then picking the one that actually holds liquidity. This matters on
  this chain: HOOD10 has five pools and four are empty or decoys.
- **The launch instant** — read from that pool's block, so the cycle seed cannot
  be accused of having been chosen after seeing the sequence it produces.
- **The fee** — taken from the pool's own v4 fee tier.
- **Price and exit depth** — `slot0` and in-range liquidity, same as every other
  venue on the scanner.

## 3. Run preflight

```bash
npm run preflight
```

Checks the things that must be true before money moves, against the chain rather
than against the config that claims them: the RPC is on 4663, the payout asset
is the real SPCX and not one of the dozens of look-alikes, the token's pool
exists and is paired against what `payoutAsset` says, the account holds
something, and the payroll wallet has ETH for gas.

It exits non-zero on any blocking problem. **If it fails, do not run the crank.**

Two things it will always report as notes, because they are true and permanent:
SPCX is a **beacon proxy** (upgradeable by whoever controls the beacon) and
exposes a **pause switch**. That is the shape of every tokenized stock on this
chain — the issuer's powers pass through to anything denominated in them. It is
disclosed on the payroll page rather than buried here.

```bash
npm run verify:ledger
```

Rehearses the ledger rebuild — the most failure-prone step — against a live,
busy token. It exercises the shipped reader, not a copy of it. Last run: 129,945
balance events over 75 minutes in 25 seconds, shares summing to 1.000000000.

## 4. Check it came up

```bash
npm run dev
```

Open `/mechanics`. It should leave pre-launch on its own and show:

- the account balance, linked to the explorer
- the number of wallets on the ledger, and how many balance events were replayed
- total service — the denominator the next run divides by
- the current cycle index, with **no countdown** (see below)

If it still says *not deployed*, the address is not set. If it says *no pool
holding liquidity was found*, the launchpad has not seeded the pool yet.

## 5. Before announcing

```bash
npm run build && npm run lint && npm test
```

`npm test` runs both suites: the payroll arithmetic in TypeScript, and the
contract in Solidity. Both properties the page advertises are asserted in code
rather than in prose, because they are claims about other people's money.

```bash
npm run test:fork   # the contract against the real SPCX on a mainnet fork
```

Slower (~4 minutes) and worth running before deploying the contract. A mock
token proves the contract works and proves nothing about the token it will be
pointed at.

## 6. Start the crank

```bash
npm run crank            # decides and writes a plan, sends nothing
npm run crank:execute    # also sends, needs PAYROLL_PRIVATE_KEY
```

Run it dry first. It prints one line — `SETTLE` or `HOLD` — with the reason, and
writes the decision to `payroll/runs.jsonl` either way. That file is the audit
trail: anyone holding it can replay a run and check the arithmetic.

Once it looks right, put it on cron **every ten minutes**:

```
*/10 * * * * cd /path/to/kaji && npm run crank:execute >> logs/crank.log 2>&1
```

**The cron is not the schedule.** It is how often the question gets asked. Two
gates decide whether a run actually fires:

| Gate | Why |
|---|---|
| The seeded cycle has closed | Averages an hour, spread 45–75 min. A cron on a published hour would hand the moment back to the wallets the service integral exists to exclude |
| The account covers settlement 20× over | A quiet cycle rolls forward instead of burning gas. HOOD10 puts the reasoning well: a fixed short interval spends a rising share of the dividend on gas as volume falls |

Cadence was matched to the field rather than picked: The Index settles hourly
(`interval()` reads 3600), Quotrons gates on a WETH floor with a sixty-second
minimum, HOOD10 cranks every three hours behind a cost gate. Nobody runs on six
or eight hours.

Settlement cost at this chain's gas price is cents — roughly $5 to pay 3,000
wallets — so the 20× floor is low in absolute terms and still means a run always
delivers far more than it burns.

`PAYROLL_PRIVATE_KEY` must be the key for the wallet in `payrollAccount`. The
crank refuses to send if it is not, rather than paying from somewhere unexpected.
State advances only after the sends, so a crash retries the cycle instead of
skipping it.

## Things not to change without thinking

**Do not publish the next run time.** The cycle length is seeded from the launch
instant and the cycle index — identical for every viewer, predictable by none.
Publishing the moment hands it straight back to the late buyers the service
integral exists to exclude. The page shows the cycle *index*, never a countdown.

**Do not soften the trust notice.** The payroll account is a wallet, and whoever
holds its key can decline to run payroll. That sits at the top of the Mechanics page. Every
project in this shape carries the same exposure and most of them do not say so;
saying it is the product.

**Do not add a projected APY.** Income is a share of trading volume, and volume
decays — the scanner exists to show that about other people's tokens. Publishing
one for ours would be the exact thing the rest of the app refuses to do.

## What is still open

- **Minimum balance.** Currently zero — everyone who holds, earns. Raising it
  bounds the payout cost per run; it also excludes small holders. `minimumBalance`
  in the same config block.
- **Its own row on the scanner.** Once live, PONSAJI's token can be measured by
  PONSAJI's own instrument, on the same axis as the venues it ranks. That is the
  strongest version of the product story and it needs no new machinery.
