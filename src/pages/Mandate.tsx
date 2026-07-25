import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ScenePlate from '../components/ScenePlate'
import { AppShell } from '../components/AppShell'
import { DEFAULT_MANDATE, type ApprovalMode, type Mandate as MandateType, type RiskMode } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import './Mandate.css'

type Draft = {
  capital: string
  base_asset: string
  risk_mode: RiskMode
  drawdown: string
  slippage: string
  liquidity: string
  allow_leverage: boolean
  approval_mode: ApprovalMode
}

type Errors = Partial<Record<keyof Draft, string>>

const ASSETS = ['USDG', 'USDC', 'USDT']
const RISK_MODES: RiskMode[] = ['conservative', 'measured', 'opportunistic']

function toDraft(m: MandateType): Draft {
  return {
    capital: String(m.capital_usd),
    base_asset: m.base_asset,
    risk_mode: m.risk_mode,
    drawdown: (m.max_drawdown_bps / 100).toString(),
    slippage: (m.max_slippage_bps / 100).toString(),
    liquidity: String(m.min_exit_liquidity_usd),
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

  if (!Number.isFinite(capital) || capital <= 0) e.capital = 'Enter the capital this mandate may commit, in whole dollars.'
  else if (capital > 100_000_000) e.capital = 'Cap is $100,000,000 per mandate. Split larger allocations.'

  if (!Number.isFinite(drawdown) || drawdown <= 0) e.drawdown = 'Enter a drawdown ceiling above 0%.'
  else if (drawdown > 50) e.drawdown = 'A ceiling above 50% offers no protection. Use 0.1–50%.'

  if (!Number.isFinite(slippage) || slippage <= 0) e.slippage = 'Enter a slippage ceiling above 0%.'
  else if (slippage > 5) e.slippage = 'Above 5% the agent would accept very poor fills. Use 0.01–5%.'

  if (!Number.isFinite(liquidity) || liquidity < 0) e.liquidity = 'Enter the minimum exit depth in dollars.'
  else if (liquidity < capital)
    e.liquidity = 'Exit depth below your capital means you could not unwind in full. Raise it above the capital cap.'

  return e
}

export default function Mandate() {
  const navigate = useNavigate()
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
      base_asset: draft.base_asset,
      risk_mode: draft.risk_mode,
      max_drawdown_bps: Math.round(Number(draft.drawdown) * 100),
      max_slippage_bps: Math.round(Number(draft.slippage) * 100),
      min_exit_liquidity_usd: Number(draft.liquidity),
      allow_leverage: draft.allow_leverage,
      approval_mode: draft.approval_mode,
      protocol_allowlist: DEFAULT_MANDATE.protocol_allowlist,
      updated_at: Date.now(),
    })
    navigate('/opportunities')
  }

  return (
    <AppShell plate={<ScenePlate scene="kaji-mandate" className="mandatePage__plate" />}>
      <div className="mandatePage__scrim" aria-hidden="true" />

      <div className="controlPlaque" aria-hidden="true">
        <span className="controlPlaque__id">SJ-01</span>
        <span className="controlPlaque__sub">CONTROL UNIT</span>
        <span className="controlPlaque__meta">
          SERIAL: SJ01-8847-A
          <br />
          STATUS: {isValid ? 'WITHIN SPEC' : 'CALIBRATING'}
        </span>
      </div>
      <div className="systemStatus" aria-hidden="true">
        <span className="mono-label">SYSTEM STATUS</span>
        <span className={`systemStatus__value ${isValid ? '' : 'systemStatus__value--warn'}`}>
          {isValid ? 'SAFE' : 'CHECK'}
        </span>
      </div>

      <div className="mandatePage__content">
        <h1 className="display-h1 mandatePage__h1">
          Set the machine limits<span className="lime-period">.</span>
        </h1>
        <p className="mandatePage__sub">
          These constraints compile into the policy engine. SAJI will not prepare any action that violates them, and it
          pauses itself when a live position drifts outside.
        </p>

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
              <select
                className="limitRow__unit"
                value={draft.base_asset}
                onChange={(e) => set('base_asset', e.target.value)}
                aria-label="Base asset"
              >
                {ASSETS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <p id="capital-note" className={`fieldNote ${showError('capital') ? 'fieldNote--error' : ''}`}>
            {showError('capital') || 'The most the agent may ever commit across all positions.'}
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
            {showError('drawdown') || 'Simulated drawdown beyond this needs your approval before anything executes.'}
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
            {showError('slippage') || 'Orders are not submitted past this ceiling — the machine stops instead.'}
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
            {showError('liquidity') || 'Recipes with thinner exit depth are filtered out of the scanner entirely.'}
          </p>

          <div className="limitRow">
            <span className="limitRow__index" aria-hidden="true">
              06
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
              07
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
                <option value="manual">MANUAL — YOU SIGN EVERY ACTION</option>
                <option value="session_key">SESSION KEY — SCOPED, REVOCABLE</option>
              </select>
            </div>
          </div>

          {submitted && !isValid && (
            <p className="mandatePage__formError" role="alert">
              {Object.keys(errors).length} limit{Object.keys(errors).length > 1 ? 's need' : ' needs'} attention before
              this mandate can compile.
            </p>
          )}

          <div className="mandatePage__actions">
            <button type="submit" className="btn-lime mandatePage__simulate">
              COMPILE MANDATE <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="btn-outline" onClick={() => setDraft(toDraft(DEFAULT_MANDATE))}>
              RESET TO DEFAULTS
            </button>
          </div>
        </form>
      </div>

      <div className="allowlistPanel">
        <span className="mono-label mono-label--lime allowlistPanel__title">PROTOCOL ALLOWLIST</span>
        <div className="allowlistPanel__select">SAJI Standard v1</div>
        <div className={`allowlistPanel__ok ${isValid ? '' : 'allowlistPanel__ok--warn'}`}>
          {isValid ? 'ALL SYSTEMS WITHIN SPEC.' : 'LIMITS OUT OF RANGE.'} <span aria-hidden="true">{isValid ? '✓' : '!'}</span>
        </div>
      </div>
    </AppShell>
  )
}
