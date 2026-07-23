# Design

Visual system for Kaji. Source of truth for tokens is `src/index.css`; this document explains intent and usage rules.

## Theme

Committed dark. The scene: an allocator checking a position at night on a large monitor, in a dim room, wanting the screen to feel like an instrument reading rather than a marketing page. Near-black steel surfaces with one chartreuse signal doing all functional work.

## Color

| Token | Value | Use |
|---|---|---|
| `--foundry-black` | `#060706` | Page background |
| `--machine-black` | `#111411` | Raised machine surfaces, inputs |
| `--panel-black` | `#0c0e0c` | Panels, tables, cards |
| `--steel-border` | `#262a25` | Hairline borders (1px only) |
| `--steel` | `#5f645e` | Disabled, tertiary marks |
| `--steel-light` | `#aeb2aa` | Secondary text, labels (4.6:1 on panel) |
| `--chalk` | `#f0f1eb` | Primary text |
| `--signal-lime` | `#cfff00` | Active flow, selection, safe output, primary action |
| `--warning-amber` | `#d38a28` | Review / approval required / paused |
| `--fault-red` | `#ff4b43` | Hard stop only |

Lime is functional, never decorative. Amber means a human must look. Red is reserved for a stopped machine. Every state carries a text label beside its colour.

## Typography

- Display — Barlow Condensed 800, uppercase, `-0.02em`. Page headlines and machine-panel numerals only.
- Body — Public Sans. Sentence case, prose and descriptions.
- Data — IBM Plex Mono. Labels, metrics, addresses, timestamps, status.

Fixed rem-adjacent steps inside the app shell; `clamp()` only on the landing hero and page H1s. All-caps limited to short machine labels.

## Shape & materials

Rectilinear and machined. Radius 0–3px on panels and buttons; full pills only for status tags. Thin steel borders, no soft-shadow cards, no glassmorphism. Charts read as inspection traces or physical gauges.

## Motion

150–250ms, ease-out. Motion conveys state only: flow pulses, gauge settles, status changes. Media plates loop with a locked camera. `prefers-reduced-motion` swaps every loop for its poster and drops non-essential transitions.

## Components

Every interactive element ships default, hover, focus-visible, active, disabled, loading and error. Focus is a 2px lime ring at 2px offset, never removed. Async surfaces use skeletons, not spinners. Empty states teach the next action.

## Media plates

Physical scenes are generated media (`public/assets/kaji-<scene>-*`), never screenshots of UI. Readable text, metrics and controls are always native HTML above the plate, separated by a scrim that guarantees contrast. Each page carries a poster, a WebM and an MP4; the hero additionally carries a 9:16 mobile composition.
