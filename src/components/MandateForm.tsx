import { useMemo, useState, type FormEvent } from 'react'
import { VAULTS } from '../lib/chain'
import { DISTRIBUTION_VENUES } from '../lib/venues'
import { DEFAULT_MANDATE, type ApprovalMode, type Mandate as MandateType, type RiskMode } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import './MandateForm.css'

/**
 * The limits, as a form.
 *
 * This used to be its own page. It is settings for the scanner — you change a
 * ceiling to see which rows flip to BLOCKED — so it now lives beside the table
 * it governs rather than a navigation away from it.
 */
type Draft = {
  capital: string
  base_assets: string[]
  risk_mode: RiskMode
  drawdown: string
  slippage: string
  liquidity: string
  round_trip: string
  breakeven: string
  allow_leverage: boolean
  approval_mode: ApprovalMode
}

type Errors = Partial<Record<keyof Draft, string>>

/**
 * Only assets PONSAJI actually has recipes for. Offering a denomination with no
 * venue behind it would compile a mandate that blocks every row in the scanner.
 * Vaults settle in their underlying; the distribution venues settle in ETH.
 */
const ASSETS = [
  ...new Set([...VAULTS.map((v) => v.asset.symbol), ...DISTRIBUTION_VENUES.map((v) => v.quoteAsset)]),
]
const RISK_MODES: RiskMode[] = ['conservative', 'measured', 'opportunistic']

function toDraft(m: MandateType): Draft {
  return {
    capital: String(m.capital_usd),
    base_assets: m.base_assets,
    risk_mode: m.risk_mode,
    drawdown: (m.max_drawdown_bps / 100).toString(),
    slippage: (m.max_slippage_bps / 100).toString(),
    liquidity: String(m.min_exit_liquidity_usd),
    round_trip: (m.max_round_trip_bps / 100).toString(),
    breakeven: String(m.max_breakeven_days),
    allow_leverage: m.allow_leverage,
    approval_mode: m.approval_mode,
  }
}

/** Field-level validation. Every message says what to do, not just what's wrong. */
function validate(d: Draft): Errors {
  const e: Errors = {}
  const capital = Number(d.capital)
  const drawdown = Number(d.drawdown)
  const slippage = Number(d.slippage)
  const liquidity = Number(d.liquidity)
  const roundTrip = Number(d.round_trip)
  const breakeven = Number(d.breakeven)

  if (!Number.isFinite(capital) || capital <= 0) e.capital = 'Enter the capital this mandate may commit, in whole dollars.'
  else if (capital > 100_000_000) e.capital = 'Cap is $100,000,000 per mandate. Split larger allocations.'

  if (!Number.isFinite(drawdown) || drawdown <= 0) e.drawdown = 'Enter a drawdown ceiling above 0%.'
  else if (drawdown > 50) e.drawdown = 'A ceiling above 50% offers no protection. Use 0.1–50%.'

  if (!Number.isFinite(slippage) || slippage <= 0) e.slippage = 'Enter a slippage ceiling above 0%.'
  else if (slippage > 5) e.slippage = 'Above 5% this would clear very poor fills. Use 0.01–5%.'

  if (!Number.isFinite(liquidity) || liquidity < 0) e.liquidity = 'Enter the minimum exit depth in dollars.'
  else if (liquidity < capital)
    e.liquidity = 'Exit depth below your capital means you could not unwind in full. Raise it above the capital cap.'

  if (!Number.isFinite(roundTrip) || roundTrip < 0) e.round_trip = 'Enter the most you will pay to enter and exit, combined.'
  else if (roundTrip > 25) e.round_trip = 'Above 25% a round trip costs more than most positions ever earn back. Use 0–25%.'

  if (!Number.isFinite(breakeven) || breakeven <= 0) e.breakeven = 'Enter how many days a position may take to repay its own cost.'
  else if (breakeven > 3650) e.breakeven = 'Ten years is not a horizon. Use 1–3650 days.'

  if (d.base_assets.length === 0) e.base_assets = 'Authorise at least one settlement asset, or nothing can be prepared.'

  return e
}
export default function MandateForm({ onSaved }: { onSaved?: () => void }) {
  const { mandate, setMandate } = useAgent()
  const [draft, setDraft] = useState<Draft>(() => toDraft(mandate ?? DEFAULT_MANDATE))
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)

  const errors = useMemo(() => validate(draft), [draft])
  const showError = (k: keyof Draft) => (touched[k] || submitted) && errors[k]
  const isValid = Object.keys(errors).length === 0

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (!isValid) {
      // Field ids match the draft keys, so the first error maps straight to its input.
      const firstError = Object.keys(errors)[0]
      document.getElementById(firstError)?.focus()
      return
    }
    setMandate({
      capital_usd: Number(draft.capital),
      base_assets: draft.base_assets,
      risk_mode: draft.risk_mode,
      max_drawdown_bps: Math.round(Number(draft.drawdown) * 100),
      max_slippage_bps: Math.round(Number(draft.slippage) * 100),
      min_exit_liquidity_usd: Number(draft.liquidity),
      max_round_trip_bps: Math.round(Number(draft.round_trip) * 100),
      max_breakeven_days: Number(draft.breakeven),
      allow_leverage: draft.allow_leverage,
      approval_mode: draft.approval_mode,
      protocol_allowlist: DEFAULT_MANDATE.protocol_allowlist,
      updated_at: Date.now(),
    })
    onSaved?.()
  }

  return (
      <form className="limitForm" onSubmit={onSubmit} noValidate>
        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            01
          </span>
          <label className="limitRow__label mono-label" htmlFor="capital">
            CAPITAL CAP
          </label>
          <div className="limitRow__field">
            <input
              id="capital"
              inputMode="numeric"
              value={draft.capital}
              onChange={(e) => set('capital', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, capital: true }))}
              aria-invalid={Boolean(showError('capital'))}
              aria-describedby="capital-note"
            />
            {/* A mandate authorises settlement assets, not one asset: the two
                venue classes settle differently and refusing to say which you
                hold is an omission, not a constraint. */}
            <div className="assetToggles" role="group" aria-label="Settlement assets this mandate authorises">
              {ASSETS.map((a) => {
                const on = draft.base_assets.includes(a)
                return (
                  <button
                    key={a}
                    type="button"
                    className={`assetToggle ${on ? 'assetToggle--on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      set('base_assets', on ? draft.base_assets.filter((x) => x !== a) : [...draft.base_assets, a])
                    }
                  >
                    {a}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <p id="capital-note" className={`fieldNote ${showError('capital') ? 'fieldNote--error' : ''}`}>
          {showError('capital') ||
            showError('base_assets') ||
            'The most PONSAJI may commit across all open positions, in the assets you authorise above.'}
        </p>

        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            02
          </span>
          <label className="limitRow__label mono-label" htmlFor="risk">
            RISK MODE
          </label>
          <div className="limitRow__field">
            <select id="risk" value={draft.risk_mode} onChange={(e) => set('risk_mode', e.target.value as RiskMode)}>
              {RISK_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            03
          </span>
          <label className="limitRow__label mono-label" htmlFor="drawdown">
            MAX DRAWDOWN
          </label>
          <div className="limitRow__field">
            <input
              id="drawdown"
              inputMode="decimal"
              value={draft.drawdown}
              onChange={(e) => set('drawdown', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, drawdown: true }))}
              aria-invalid={Boolean(showError('drawdown'))}
              aria-describedby="drawdown-note"
            />
            <span className="limitRow__unit limitRow__unit--static">%</span>
          </div>
        </div>
        <p id="drawdown-note" className={`fieldNote ${showError('drawdown') ? 'fieldNote--error' : ''}`}>
          {showError('drawdown') || 'A recipe whose simulated drawdown exceeds this is stamped BLOCKED rather than offered.'}
        </p>

        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            04
          </span>
          <label className="limitRow__label mono-label" htmlFor="slippage">
            MAX SLIPPAGE
          </label>
          <div className="limitRow__field">
            <input
              id="slippage"
              inputMode="decimal"
              value={draft.slippage}
              onChange={(e) => set('slippage', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, slippage: true }))}
              aria-invalid={Boolean(showError('slippage'))}
              aria-describedby="slippage-note"
            />
            <span className="limitRow__unit limitRow__unit--static">%</span>
          </div>
        </div>
        <p id="slippage-note" className={`fieldNote ${showError('slippage') ? 'fieldNote--error' : ''}`}>
          {showError('slippage') || 'Nothing is prepared for signature past this ceiling.'}
        </p>

        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            05
          </span>
          <label className="limitRow__label mono-label" htmlFor="liquidity">
            MIN EXIT LIQUIDITY
          </label>
          <div className="limitRow__field">
            <input
              id="liquidity"
              inputMode="numeric"
              value={draft.liquidity}
              onChange={(e) => set('liquidity', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, liquidity: true }))}
              aria-invalid={Boolean(showError('liquidity'))}
              aria-describedby="liquidity-note"
            />
            <span className="limitRow__unit limitRow__unit--static">USD</span>
          </div>
        </div>
        <p id="liquidity-note" className={`fieldNote ${showError('liquidity') ? 'fieldNote--error' : ''}`}>
          {showError('liquidity') ||
            'Recipes with thinner exit depth are stamped BLOCKED in the scanner and cannot be prepared. Hide them with the scanner’s own filter.'}
        </p>

        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            06
          </span>
          <label className="limitRow__label mono-label" htmlFor="round_trip">
            MAX ROUND TRIP
          </label>
          <div className="limitRow__field">
            <input
              id="round_trip"
              inputMode="decimal"
              value={draft.round_trip}
              onChange={(e) => set('round_trip', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, round_trip: true }))}
              aria-invalid={Boolean(showError('round_trip'))}
              aria-describedby="round_trip-note"
            />
            <span className="limitRow__unit limitRow__unit--static">%</span>
          </div>
        </div>
        <p id="round_trip-note" className={`fieldNote ${showError('round_trip') ? 'fieldNote--error' : ''}`}>
          {showError('round_trip') ||
            'Entry fee plus exit fee. A venue charging 3% each way costs 6% before it has earned anything.'}
        </p>

        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            07
          </span>
          <label className="limitRow__label mono-label" htmlFor="breakeven">
            MAX BREAK-EVEN
          </label>
          <div className="limitRow__field">
            <input
              id="breakeven"
              inputMode="numeric"
              value={draft.breakeven}
              onChange={(e) => set('breakeven', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, breakeven: true }))}
              aria-invalid={Boolean(showError('breakeven'))}
              aria-describedby="breakeven-note"
            />
            <span className="limitRow__unit limitRow__unit--static">DAYS</span>
          </div>
        </div>
        <p id="breakeven-note" className={`fieldNote ${showError('breakeven') ? 'fieldNote--error' : ''}`}>
          {showError('breakeven') ||
            'How long a position may take to repay its own round trip. Judged against a decaying volume regime, not a flat one.'}
        </p>

        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            08
          </span>
          <label className="limitRow__label mono-label" htmlFor="leverage">
            LEVERAGE
          </label>
          <div className="limitRow__field">
            <select
              id="leverage"
              value={draft.allow_leverage ? 'on' : 'off'}
              onChange={(e) => set('allow_leverage', e.target.value === 'on')}
            >
              <option value="off">OFF</option>
              <option value="on">PERMITTED</option>
            </select>
          </div>
        </div>

        <div className="limitRow">
          <span className="limitRow__index" aria-hidden="true">
            09
          </span>
          <label className="limitRow__label mono-label" htmlFor="approval">
            APPROVAL MODE
          </label>
          <div className="limitRow__field">
            <select
              id="approval"
              value={draft.approval_mode}
              onChange={(e) => set('approval_mode', e.target.value as ApprovalMode)}
            >
              <option value="manual">MANUAL: YOU SIGN EVERY ACTION</option>
              {/* No session-key mechanism is deployed. Offering it as a
                  selectable mode would promise a delegation this build
                  cannot perform. */}
              <option value="session_key" disabled>
                SESSION KEY: NOT YET DEPLOYED
              </option>
            </select>
          </div>
        </div>
        <p className="fieldNote">
          Manual is the only mode this build can honour: every action is signed by your wallet. Scoped session keys are
          not deployed yet.
        </p>

        {submitted && !isValid && (
          <p className="limitForm__error" role="alert">
            {Object.keys(errors).length} limit{Object.keys(errors).length > 1 ? 's need' : ' needs'} attention before
            these can be applied.
          </p>
        )}

        <div className="limitForm__actions">
          <button type="submit" className="btn-lime limitForm__submit">
            APPLY LIMITS <span aria-hidden="true">→</span>
          </button>
          <button type="button" className="btn-outline" onClick={() => setDraft(toDraft(DEFAULT_MANDATE))}>
            RESET TO DEFAULTS
          </button>
        </div>
      </form>
  )
}
