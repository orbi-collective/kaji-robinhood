# PONSAJI

**Hold PONSAJI. Earn stocks. Paid for time actually held.**

A token on Robinhood Chain (chain id 4663). Trading fees buy a tokenized stock,
and that stock is paid out to holders. The difference from everything else on
this chain is *how* it decides who gets what.

Site: **ponsaji.com** (pending) · X: **[@getponsaji](https://x.com/getponsaji)**

---

## The problem this fixes

There is a whole category of token on this chain now. The Index, Quotrons,
HOOD10, and others. They all work roughly the same way: the token charges a fee
on every trade, the fee buys tokenized stocks, and the stocks go to holders.

They also all share the same hole. **They pay on a snapshot.**

At some moment the contract looks at who holds the token, and splits the pot by
balance at that instant. Which means the optimal play is not to hold. It is to
buy a few seconds before the snapshot, collect a full share, and sell.

Someone who held for six hours and someone who held for six seconds get the same
rate. The person who actually carried the risk subsidises the person who timed
it. Everyone can see this, so everyone does it, and the payout drifts toward
people who are not really holders at all.

## What PONSAJI does instead

It pays for **time held**, not for holding at the right second.

Your claim is the area under your balance over time. Hold 1,000 tokens for four
hours and you have earned twice what 1,000 tokens for two hours earned. Formally,
for a wallet *i* over a cycle ending at *T*:

```
wᵢ(T) = ∫ bᵢ(t) dt        integrated from the last time i reduced its balance
shareᵢ = wᵢ / Σⱼ wⱼ
```

The key rule: **any reduction in your balance resets your clock to zero.** Sell
one token and the service you accrued is gone. You start again from that moment.

Two things follow from this, and both are proven in the test suite rather than
claimed in a pitch:

**Buying late cannot be bought off.** A wallet arriving with size *q* at time
*τ* before the close gets `qτ / (qτ + W)`, where *W* is everyone else's
accumulated service. As *τ* goes to zero, so does the share. There is no amount
of capital that fixes arriving late, because the thing being measured is time,
and you cannot buy backwards.

**Splitting across wallets gains nothing.** Divide *q* across *k* wallets and
each earns `(q/k)·τ`. Sum them: `q·τ`. Exactly what one wallet would have earned.
Sybil attacks are not defended against here, they are arithmetically pointless.

## How a payout actually happens

1. Trading on the launchpad pays a fee. The creator's share of that fee lands in
   a wallet, the **payroll account**, already denominated in the payout asset.
   No treasury, no revenue story. Trading is the whole economy.
2. A cycle closes. Cycle length is between **45 and 75 minutes**, drawn from the
   launch instant and the cycle index. The same sequence for everyone,
   predictable by nobody. The exact moment is deliberately never published,
   because a published moment is one a late buyer trades around.
3. Every wallet's service is computed from the token's own Transfer logs.
4. Everyone is paid in a single batch transaction.

Holders are paid in **SPCX**, a tokenized stock. PONSAJI is paired against SPCX
on the launchpad, so fees arrive already in SPCX and payroll never has to swap.
No slippage, no routing, nothing between the fee and the holder.

SPCX was picked after measuring what the Uniswap v4 PoolManager actually holds
for each candidate, because paying people in something they cannot sell is its
own kind of dishonesty. It sits at roughly $1.46M of pool liquidity, comfortably
inside the tradable set.

## The contract

`PonsajiPayroll` is about forty lines and does one thing: pay a list of
recipients in one transaction.

Every leg is a `transferFrom` of the **caller's own allowance**. That single
choice gives three properties at once:

- It can only ever spend what the caller approved. Not your tokens, not anyone
  else's.
- It never holds a balance. Money goes from payer to recipient, never through
  the contract.
- There is no owner, no pause, no upgrade. Nothing to seize and nobody to trust.

If any single transfer fails, the whole batch reverts. Nobody gets a partial
payout.

Measured: 37,664 gas per recipient against the real SPCX token, and 15,065,686
gas for a full 400-recipient batch. 13 tests, including a fuzz test over
arbitrary batches.

## What you can check yourself

This is the part that matters more than any claim above.

The payout is computed from public Transfer logs. Anyone with an RPC endpoint
can replay the same logs and arrive at the same split. The repo ships
`scripts/crosscheck.ts`, which does exactly that, using code that deliberately
shares nothing with the payroll engine. On the last full rehearsal it reproduced
every wallet's payout to a delta of zero.

That check exists because it already caught a real bug. An earlier version
estimated block timestamps by drawing a straight line between two points,
assuming blocks arrive every 0.101 seconds. Service is balance multiplied by
time, so a wrong timestamp moves real money between wallets, silently. On a
chain with uneven blocks it put events up to sixteen minutes from where they
really happened. Timestamps are now measured, and every run records whether it
got exact times or estimates.

## What it does not promise

Worth reading before you decide anything.

- **The payroll account is a wallet, not a contract.** Whoever holds that key
  can decline to run payroll. No contract compels a distribution. Every project
  in this shape carries the same exposure, and most of them do not say so. What
  is offered instead of a promise: the account address is published and its
  balance is readable live, so you can watch it fill and empty.
- **No APY is published**, and none will be. Income here decays with trading
  volume, and annualising a decaying series produces a number that is wrong in a
  flattering direction.
- **Money that arrives later pays the people who were already here.** That is
  the shape of every token of this kind on this chain. It belongs on the front
  of the page, not behind a roadmap.
- **The payout asset is a third-party tokenized stock** on an upgradeable,
  pausable contract. That risk passes through to you.
- The account holds whatever trading has put in it, which may be a great deal or
  nothing at all.

Nothing here is financial advice.

## Status

| | |
|---|---|
| Payroll engine | built, tested, rehearsed end to end |
| Batch contract | written and tested, **not yet deployed** |
| Token | **not yet deployed** (goes out on Launchpad Pons) |
| Website | built |
| X account | [@getponsaji](https://x.com/getponsaji) |

Until the token is deployed, every figure on the site reads zero. Not a
placeholder, not a projection. Zero, because there is genuinely no account, no
ledger, and nothing to divide yet.

That is a rule the whole project is built on: no number gets displayed without a
real read behind it, and "unknown" never renders as a confident value.
