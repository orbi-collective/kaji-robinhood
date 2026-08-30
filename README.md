# PONSAJI — Carry Foundry

A non-custodial measuring instrument for Robinhood Chain. PONSAJI prices two classes of stablecoin position against each other — **ERC-4626 vaults**, where capital compounds, and **fee-distribution tokens**, where capital buys a share of somebody else's trading volume — subtracts every cost, and refuses to prepare anything that breaks a mandate you set.

**It never takes custody, never signs, and runs no background process. Your wallet is the only signer.**

## Why the second venue class exists

Both fee-distribution protocols on this chain advertise what they pay. Neither shows what a position costs to enter and exit, how fast the payout is decaying, or how long capital must sit before the income has repaid the round trip.

PONSAJI computes that, states it under three volume regimes, and blocks the position when it fails your mandate. On a $1,000 position in The Index at the time of writing, the answer is: **53 days if volume holds flat, and never under any decaying regime** — against a 6% round trip read straight from the fee hook.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle to dist/
npm run lint
```

## The break-even model

For a pro-rata distribution the cycle total cancels out of the income equation, so one recipient's payout divided by their balance is the whole answer. PONSAJI samples five real payouts rather than summing a cycle of several thousand — exact, and far more robust across a flaky public endpoint.

```
round_trip       = entry_fee + exit_fee + price_impact + gas
payout_per_token = payout_to_recipient / recipient_balance
income_per_day   = payout_per_token × tokens_held × payout_price × legs × cycles_per_day

k     = ln(weekly_retention) / 7
days  = ln(1 + cost·k / income_per_day) / k
```

When the decaying series converges below the cost, the position never repays and PONSAJI reports `NEVER` rather than a large number that looks like a long wait.

Sampling several recipients also turns each venue's pro-rata claim into something *checked* rather than repeated: if the sampled payouts per token disagree, the row says so.

## End-to-end user flow

```
Landing  →  Scanner  →  Recipe + simulator  →  Transaction preview  →  Vault  →  Security
   /       /opportunities   /recipes/:id      (policy-gated deposit)  /vaults/:addr  /security
```

1. **Scanner** (`/opportunities`) ranks recipes by net carry per unit of risk and stamps each row with its own policy verdict against your mandate. Anything the engine would refuse is marked `BLOCKED` and cannot be prepared.
2. **Limits** live in a panel on the scanner (`?limits=1`), not a page of their own — you change a ceiling and watch the verdicts move. Typed constraints: capital cap, drawdown, slippage, exit-liquidity floor, round trip, break-even, leverage, approval mode. Validated per field; persisted locally.
3. **Recipe** (`/recipes/:id`) itemises the full net-carry breakdown, runs the five-input simulator, and shows what breaks the strategy.
4. **Transaction preview** states every step the wallet is asked to sign, every policy check with its observed-vs-bound values, and the estimate's assumptions — before any signature.
5. **Vault** (`/vaults/:address`) shows deployed capital, allocation, risk budget and the event log, re-read from the chain each time it is opened.
6. **Security** (`/security`) computes guardrails from live state. It carries no stop control: nothing runs in the background, so there would be nothing for one to halt.

## Architecture

| Path | Responsibility |
|---|---|
| `src/lib/types.ts` | Domain model — mandate, opportunity, policy, simulation, position |
| `src/lib/policy.ts` | Deterministic policy engine + net-carry equation + stress simulation. Pure functions, no network, no randomness — the same inputs always produce the same verdict |
| `src/lib/adapters.ts` | Vault reads, and the merge of both venue classes into one ranked list |
| `src/lib/distribution.ts` | Fee-distribution venues — fees, cadence, payout sampling, pro-rata verification |
| `src/lib/breakeven.ts` | Round-trip cost ladder and the decay-regime horizon |
| `src/lib/uniswapV4.ts` | v4 pool-key derivation and `extsload` price reads — the only onchain price source on this chain |
| `src/lib/venues.ts` | Distribution venue configuration and the tokenized-stock basket |
| `src/lib/feeds.ts` | Chainlink reads, shared by both venue classes |
| `src/lib/deposit.ts` | ERC-4626 deposit path: asset assertion, balance check, simulation, allowance |
| `src/lib/abi.ts` | Minimal ABIs — only the functions PONSAJI calls |
| `src/lib/chain.ts` | Robinhood Chain + wagmi config, all env-driven |
| `src/state/AgentStore.tsx` | Mandate, positions and event log; persisted to localStorage |
| `src/components/` | App shell, wallet, transaction preview, shared UI primitives |

## Live on Robinhood Chain mainnet

The app runs against mainnet out of the box — **no `.env` required**. `.env.example` exists only to override the defaults (private RPC, a different vault).

| | |
|---|---|
| Chain | Robinhood Chain, id **4663** |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Base asset | USDG (Global Dollar), 6 decimals — `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Lending | Morpho Blue — `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` |
| Oracle | Chainlink USDG/USD — `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` (24h heartbeat) |

Vaults (Morpho Vault V2, ERC-4626, USDG):

| Recipe | Vault | Address |
|---|---|---|
| Steady Press | Steakhouse USDG | `0xBeEff033F34C046626B8D0A041844C5d1A5409dd` |
| Carry Alloy | Ethena × Steakhouse USDG | `0xbEeFF0fb1Dc19344A87b8479dAb60A2e16160737` |
| Neutral Beam | Purinta USDG | `0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8` |

### Where the numbers come from

- **TVL, underlying asset, share price** — read directly from the vault contract (`src/lib/adapters.ts`).
- **Oracle age** — Chainlink `latestRoundData().updatedAt`, judged against the feed's own published heartbeat rather than an invented constant.
- **Forward APY and liquidity** — Morpho's public GraphQL API (`vaultV2s`). If it is unreachable or returns an unexpected shape, that row degrades to `DEMO` instead of pairing a real TVL with a made-up yield.
- **Risk score** — derived in `deriveRiskScore()` from liquid ratio, vault depth and yield premium. No hand-assigned numbers.

### Deposit safety

`src/lib/deposit.ts` runs three checks before a wallet is ever asked to sign:

1. the vault's `asset()` must equal the configured USDG (the chain carries several look-alike "Global Dollar" ERC-20s),
2. the wallet balance must cover the allocation, and
3. the deposit must `simulateContract` cleanly against current state.

Allowance is requested only when short, and only for the exact amount. `verifyDeployment()` re-runs check 1 for every vault on the Security page, where a mismatch shows as a blocked guardrail.

## Deployment

Static SPA. `vercel.json` (rewrites, immutable asset caching, security headers) and `public/_redirects` (Netlify) are included; any host needs the SPA fallback to `index.html`.

## Machine-readable

`/llms.txt` and `/llms-full.txt` carry the whole model — every equation, source, policy check and known limit — as plain text at the standard paths. The full page text also renders in the DOM, collapsed sections included, so assistants and crawlers read the substance rather than a summary.

## Known limits

- **No background process.** Nothing is monitored while the tab is closed.
- **One payout leg is measured** and scaled by the leg count each venue states it splits its basket across. That scaling is a documented claim, not a measurement, and is labelled wherever it appears.
- **The public RPC intermittently returns a malformed CORS header** (`Access-Control-Allow-Origin: *,*`), which browsers reject. Reads retry, and whatever still fails degrades visibly.
- **`maxWithdraw` returns 0** on every Morpho Vault V2 holder PONSAJI has read. That is the contract declining to expose an instant exit, not a statement about the depositor's money, and it is reported as such.
- **Session keys are not deployed.** Manual signing is the only mode this build can honour, so there is no standing key and nothing to revoke.

## Media

Physical foundry scenes are generated media plates (`public/assets/kaji-<scene>-*`), never screenshots of UI. Each carries a poster, a WebM and an MP4; the hero adds a 9:16 mobile composition. `ScenePlate` handles poster layering, viewport/visibility pause-resume, and the mobile source swap. `prefers-reduced-motion` receives posters with no loss of content, and the product remains fully usable if video fails.

## Accessibility

WCAG 2.1 AA. Verified body contrast 9.2–17.8:1; keyboard operable throughout including the transaction preview (native `<dialog>`); skip link and route focus management; every state carries a text label as well as a colour.

---

> Estimates are informational and do not guarantee returns. Onchain strategies involve loss, liquidity, oracle and smart-contract risk.
