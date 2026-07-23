# KAJI — Autonomous Carry Foundry

A non-custodial AI yield agent for Robinhood Chain. Kaji scans lending, spot and hedge venues, assembles candidate recipes, simulates net carry after every cost, validates each proposed action against a deterministic policy engine, and prepares a transaction the user signs themselves.

**It never takes custody and never moves funds outside a mandate.**

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle to dist/
npm run lint
```

## End-to-end user flow

```
Landing  →  Scanner  →  Recipe + simulator  →  Transaction preview  →  Vault  →  Security
   /       /opportunities   /recipes/:id      (policy-gated deposit)  /vaults/:addr  /security
```

1. **Mandate** (`/mandates/new`) compiles typed constraints — capital cap, drawdown, slippage, exit-liquidity floor, leverage, approval mode — into the policy engine. Validated per field; persisted locally.
2. **Scanner** (`/opportunities`) ranks recipes by net carry per unit of risk and stamps each row with its own policy verdict against your mandate. Anything the engine would refuse is marked `BLOCKED` and cannot be prepared.
3. **Recipe** (`/recipes/:id`) itemises the full net-carry breakdown, runs the five-input simulator, and shows what breaks the strategy.
4. **Transaction preview** states every step the wallet is asked to sign, every policy check with its observed-vs-bound values, and the estimate's assumptions — before any signature.
5. **Vault** (`/vaults/:address`) monitors deployed capital, allocation, risk budget and the agent event log.
6. **Security** (`/security`) computes guardrails from live state and carries the emergency stop, which revokes session access and holds every position.

## Architecture

| Path | Responsibility |
|---|---|
| `src/lib/types.ts` | Domain model — mandate, opportunity, policy, simulation, position |
| `src/lib/policy.ts` | Deterministic policy engine + net-carry equation + stress simulation. Pure functions, no network, no randomness — the same inputs always produce the same verdict |
| `src/lib/adapters.ts` | Live vault + Chainlink reads. Degrades per-row to demo data on failure rather than failing the page |
| `src/lib/deposit.ts` | ERC-4626 deposit path: asset assertion, balance check, simulation, allowance |
| `src/lib/abi.ts` | Minimal ABIs — only the functions Kaji calls |
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

## Media

Physical foundry scenes are generated media plates (`public/assets/kaji-<scene>-*`), never screenshots of UI. Each carries a poster, a WebM and an MP4; the hero adds a 9:16 mobile composition. `ScenePlate` handles poster layering, viewport/visibility pause-resume, and the mobile source swap. `prefers-reduced-motion` receives posters with no loss of content, and the product remains fully usable if video fails.

## Accessibility

WCAG 2.1 AA. Verified body contrast 9.2–17.8:1; keyboard operable throughout including the transaction preview and emergency stop (native `<dialog>`); skip link and route focus management; every state carries a text label as well as a colour.

---

> Estimates are informational and do not guarantee returns. Onchain strategies involve loss, liquidity, oracle and smart-contract risk.
