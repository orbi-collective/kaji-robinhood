# SAJI Social System

This is the source of truth for SAJI social assets. Product truth remains in `PRODUCT.md`; visual tokens remain in `DESIGN.md` and `src/index.css`.

## Core idea

Every post should feel like evidence from a machine operating within spec, not an advertisement for yield.

**Voice:** heavy, exact, calm. State measurements and consequences. Never promise a return.

**Recurring line:** `MEASURED CARRY. SIGNED BY YOU.`

## Visual grammar

- Background: foundry black `#060706`; panels may use `#0c0e0c`.
- Primary ink: chalk `#f0f1eb`; secondary ink: steel light `#aeb2aa`.
- Borders: one-pixel steel `#262a25` only.
- Signal lime `#cfff00` is functional: active status, safe output, selected flow, or one punctuation mark. Keep it below 10% of the canvas.
- Amber `#d38a28` means review or paused. Red `#ff4b43` means execution stopped. Never use either decoratively.
- Display statements: Barlow Condensed 800, uppercase, tight but not cramped.
- Evidence, timestamps, and status: IBM Plex Mono, uppercase.
- Body copy: Public Sans, sentence case.
- Shapes are rectilinear and machined. Radius is 0–3px. Status tags may be pills.
- The Triple Fold mark is locked. Do not rotate it, recolor its white outline, change its proportions, or add effects.

## Composition

Use one claim and one evidence rail. The claim receives the largest type. Evidence sits in a thin separated strip with 2–4 readings. Leave generous black negative space.

For X headers, keep the lower-left 28% free of critical text because the profile image overlaps it.

For feature posts, use this order:

1. Measured claim.
2. Inputs or constraints.
3. Timestamp or data state.
4. Consequence: sign, review, pause, or stop.

## Content families

- **Machine status:** agent state, policy verdict, feed freshness.
- **Recipe inspection:** inputs, costs, net estimate, break conditions.
- **Proof of control:** simulation result, spend cap, allowlist, emergency stop.
- **Build notes:** one product change and the user consequence it creates.
- **Risk notices:** stale, paused, breached, or revoked states treated as first-class content.

## Never use

Coins, chain-link icons, candlestick charts as decoration, floating particles, navy/purple fintech gradients, glass cards, glowing APY numbers, robots, lifestyle photography, or claims such as “safe yield,” “guaranteed,” and “risk-free.”

## Reusable image prompt

```text
Create a SAJI social asset that feels like an industrial instrument panel operating within spec.

Format: [X header / 16:9 post / square post]
Primary statement (verbatim): "[ONE MEASURED CLAIM]"
Evidence rail (verbatim): "[INPUT]" · "[STATE]" · "[CONSEQUENCE]"

Use foundry black #060706, panel black #0C0E0C, steel border #262A25, steel light #AEB2AA, chalk #F0F1EB, and signal lime #CFFF00 only as a functional status indicator. Main statement in heavy uppercase condensed grotesk. Evidence in precise uppercase monospace. One-pixel rectilinear separators, abundant black negative space, and the locked Triple Fold mark unchanged.

No generic crypto imagery, coins, chains, particles, glassmorphism, decorative gradients, fake charts, glowing APY, blue, purple, gold, 3D, or watermark.
```

## Export sizes

- X header: `1500 × 500`
- X profile: `800 × 800`
- Link preview / Open Graph: `1200 × 630`
- X landscape post: `1600 × 900`
- Square post: `1080 × 1080`
