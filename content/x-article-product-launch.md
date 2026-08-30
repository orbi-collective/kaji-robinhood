# Hold PONSAJI. Earn Stocks. Paid for Time Actually Held.

**Article deck:** A fee-distribution token designed to reward service, not snapshot timing.

Most fee-distribution tokens reward a balance at one instant.

That sounds fair until you look at what the snapshot makes possible: a wallet can arrive moments before a distribution, buy a large balance, collect a full pro-rata share, and leave. The wallets that held through the cycle absorb the dilution. Time carried the exposure; timing captured the payout.

PONSAJI changes the unit being rewarded.

Instead of asking only **“How much do you hold?”**, it asks:

**“How much did you hold, and for how long?”**

That is the entire idea behind PONSAJI.

## Where the payout comes from

PONSAJI launches through pons on Robinhood Chain.

Every buy and sell pays a trading fee. The creator share of that fee flows into a public payroll account. That account is the stream distributed to PONSAJI holders.

There is no emission schedule presented as revenue. There is no treasury yield assumption. There is no fixed APY.

The economy is deliberately simple:

**trading creates fees → fees fill the account → the account is divided among eligible holders**

PONSAJI is paired against SPCX. Creator fees therefore arrive in SPCX already. The payroll does not need to swap one asset into another before paying holders, removing a routing step and its associated slippage.

“Earn stocks” refers to that stock-denominated payout stream. At launch, the payout asset is SPCX—not a diversified basket and not a guaranteed return.

## The service integral

PONSAJI calls its accounting unit **service**.

For a wallet holding a constant balance, service is simply:

> service = token balance × time held

More generally, it is the area under that wallet’s balance-over-time curve:

> wᵢ(T) = ∫ bᵢ(t) dt

At settlement, each eligible wallet receives the same fraction of the payroll account as its fraction of total service:

> wallet share = wallet service ÷ total service

This means two wallets can hold different balances and still earn the same share if their accumulated service is equal. A wallet holding 100 tokens for ten minutes and a wallet holding 200 tokens for five minutes both contribute 1,000 token-minutes.

The payout rewards the position carried through time, not merely the balance visible at the end.

## What happens when a balance changes

The rules are intentionally asymmetric.

**If you add to your holding**, the service already earned remains. The new balance begins contributing from that point forward.

**If you reduce your holding by any amount**, the wallet’s service clock restarts. Service accumulated before the reduction is discarded for that run.

That rule is strict by design. Without it, a wallet could build time with a small position, scale up immediately before settlement, and make the old holding period appear to apply to the new size.

Selling out also removes the wallet from that settlement. A past holding is not a claim after the position has gone.

## Why buying late is different here

A late buyer can still earn service. What it cannot buy retroactively is time.

If a wallet arrives with balance `q` and only `τ` minutes remain, its maximum new service for that period is `q × τ`. Existing holders enter the same calculation with the service they have already accumulated.

As the remaining time approaches zero, the service available to a late arrival approaches zero with it. Size still matters, but size does not manufacture elapsed time.

This is materially different from a snapshot, where a token bought seconds before the read can be treated exactly like one held throughout the cycle.

## Splitting wallets does not multiply service

The accounting is linear.

Splitting a holding of `q` tokens across `k` wallets for the same duration does not create extra weight:

> Σ (q ÷ k) × time = q × time

Two wallets, ten wallets, or one thousand wallets sum back to the same service. Creating more addresses does not turn one holding into a larger economic claim.

This does not make PONSAJI immune to every possible strategy. It means the obvious wallet-splitting strategy does not change the arithmetic.

## Cycles and settlement

Service is measured over variable cycles between 45 and 75 minutes.

The interface does not publish a countdown to the next run. Instead, cycle lengths are deterministically derived from the launch instant and cycle index. Historical cycle boundaries can therefore be reproduced from the same inputs rather than chosen after the fact.

An operator process checks the system regularly, but a check is not automatically a settlement. Two gates must pass:

1. A new cycle must have closed.
2. The payroll account must cover the estimated cost of paying every eligible wallet by at least 20×.

If activity is too quiet, the account is not burned down to produce a tiny distribution. The cycle rolls forward and the fees remain in the account for a later run.

When a run proceeds, the ledger is rebuilt from the token’s Transfer events. The same balance history produces the same service records, denominator, shares, and payout plan. The decision and arithmetic can be replayed after the fact.

## How payments move

Payouts are pushed to holders. There is no claim button, claim deadline, or claim transaction for the recipient.

For efficient settlement, a small batch-sender contract moves SPCX directly from the payroll wallet to recipients using `transferFrom`.

The contract:

- can spend only the caller’s own allowance;
- never takes custody of the payout balance;
- has no owner, admin controls, upgrade path, or pause function; and
- reverts the entire batch if one transfer fails, preventing a silently partial payroll.

The batch sender is intentionally narrow. It does not decide who earns, when a run occurs, or how much anyone receives. It executes a payout plan from the wallet that approved it.

## What is onchain—and what is not

PONSAJI is not presented as a trustless autonomous protocol.

Balances and transfers are onchain. The creator-fee account is public. Payout transfers are onchain. The service ledger can be reconstructed from public events, and the arithmetic is deterministic.

But the payroll is initiated by an operator holding the creator-fee wallet’s key. That operator can delay or decline to run it. The public ledger makes this visible; it does not make the operator unnecessary.

That distinction matters. Transparency is not the same as enforcement.

SPCX also carries the risks of its issuer and contract design. It is a tokenized stock issued by a third party through an upgradeable, pausable contract. Those powers and risks pass through to a payout denominated in SPCX.

## The instrument behind the token

PONSAJI began as an instrument for measuring onchain carry.

The scanner reads vaults and fee-distribution venues, subtracts entry and exit costs, measures liquidity, tests payout decay, and calculates whether income can repay the round trip under multiple volume regimes. A deterministic policy engine blocks positions that violate user-defined limits before a wallet is asked to sign.

That instrument remains part of the product.

The difference is that the token is now the front door. The scanner provides the standard by which PONSAJI—and every competing fee-distribution venue—should be judged:

- Where does the payout come from?
- What does entering and exiting cost?
- What happens when trading volume decays?
- Can the payout be independently reconstructed?
- Which parts are enforced by contracts, and which depend on an operator?

PONSAJI should not receive softer questions simply because it is ours.

## What PONSAJI does not promise

PONSAJI does not promise an APY.

Trading volume can fall. The payroll account can receive little or nothing. Token prices can move sharply. Liquidity can disappear. Contracts can fail. The SPCX issuer can exercise upgrade or pause powers. The payroll operator can fail to execute a run.

Holding PONSAJI is not a savings account, a guaranteed dividend, or ownership of a diversified stock portfolio.

It is a token whose creator-fee stream is intended to be distributed in SPCX according to measured holding service.

The mechanism can make the division more faithful to time held. It cannot manufacture fees that trading did not produce.

## Hold PONSAJI. Earn stocks. Paid for time actually held.

The phrase is short because the mechanism should be understandable without a mythology around it.

Hold PONSAJI. Trading fills the account. Service accumulates as balance multiplied by time. Reducing the position restarts the clock. When a viable cycle settles, the account is divided by service and SPCX is pushed directly to eligible holders.

No snapshot shortcut. No fixed yield claim. No hidden source of payout.

Just a different answer to a simple question:

**Should a distribution reward whoever held at the right second—or whoever actually held?**

PONSAJI is built for the second answer.

— **PONSAJI** · [@getponsaji](https://x.com/getponsaji)

*Nothing in this article is financial advice. Onchain tokens may be volatile, illiquid, or lose all value. Verify the official contract address after it is announced by @getponsaji.*

---

## Publishing fields

**X Article title:** Hold PONSAJI. Earn Stocks. Paid for Time Actually Held.

**Suggested post copy:**

> Most fee-distribution tokens reward whoever held at one instant. PONSAJI rewards balance × time instead. Here is the complete mechanism, where the payout comes from, and what still has to be trusted.

**Cover alt text:** A luminous white and chartreuse PONSAJI triple-fold mark over a black industrial field beside the words “Paid for time actually held,” with a thin service-integral line representing balance accumulated through time.
