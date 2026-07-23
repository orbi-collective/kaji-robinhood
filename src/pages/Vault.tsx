import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ScenePlate from '../components/ScenePlate'
import { AppShell } from '../components/AppShell'
import { EmptyState, relativeTime } from '../components/ui'
import { useWalletGate } from '../components/Wallet'
import { DEFAULT_MANDATE } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import './Vault.css'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number) => `${(n * 100).toFixed(2)}%`
const CHECK_INTERVAL = 2 * 3600 + 14 * 60 + 8

function useCountdown(start: number, paused: boolean) {
  const [t, setT] = useState(start)
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setT((v) => (v > 0 ? v - 1 : start)), 1000)
    return () => clearInterval(id)
  }, [paused, start])
  const h = String(Math.floor(t / 3600)).padStart(2, '0')
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0')
  const s = String(t % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export default function Vault() {
  const { positions, events, mandate, agentPaused, totalCapital, blendedCarry, setPaused, closePosition, resolveEvent } =
    useAgent()
  const { canSign } = useWalletGate()
  const countdown = useCountdown(CHECK_INTERVAL, agentPaused)

  const active = useMemo(() => positions.filter((p) => p.status !== 'closed'), [positions])
  const riskBudget = active.length ? Math.round(active.reduce((s, p) => s + p.risk_score, 0) / active.length) : 0
  const cap = (mandate ?? DEFAULT_MANDATE).capital_usd

  const allocation = useMemo(() => {
    const byLabel = new Map<string, number>()
    for (const p of active) {
      for (const a of p.allocation) {
        byLabel.set(a.label, (byLabel.get(a.label) ?? 0) + (p.capital_usd * a.weight) / 100)
      }
    }
    const total = [...byLabel.values()].reduce((s, v) => s + v, 0) || 1
    return [...byLabel.entries()].map(([label, value]) => ({ label, pct: Math.round((value / total) * 100) }))
  }, [active])

  const pending = events.filter((e) => e.kind === 'pending')

  return (
    <AppShell>
      <div className="vaultPage__main">
        <aside className="vaultPage__side">
          <div className="agentStatus mono-label">
            AGENT STATUS <span className={`dot ${agentPaused ? 'dot--amber' : ''}`} aria-hidden="true" />{' '}
            <span className="agentStatus__live">{agentPaused ? 'PAUSED' : 'LIVE'}</span>
          </div>
          <h1 className="display-h1 vaultPage__h1">
            {active.length ? (
              <>
                The line
                <br />
                is running<span className="lime-period">.</span>
              </>
            ) : (
              <>
                The line
                <br />
                is idle<span className="lime-period">.</span>
              </>
            )}
          </h1>
          <p className="vaultPage__sub">
            {active.length
              ? `KJ-01 monitoring ${active.length} position${active.length > 1 ? 's' : ''} against your mandate.`
              : 'No capital deployed. The agent has nothing to monitor yet.'}
          </p>

          <div className="sideStats">
            <div className="sideStat">
              <div>
                <span className="mono-label">DEPLOYED CAPITAL</span>
                <span className="sideStat__value">{usd(totalCapital)}</span>
                <span className="sideStat__bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (totalCapital / cap) * 100)}%` }} />
                </span>
                <span className="mono-label sideStat__caption">{usd(cap)} MANDATE CAP</span>
              </div>
            </div>
            <div className="sideStat">
              <div>
                <span className="mono-label">BLENDED NET CARRY</span>
                <span className={`sideStat__value ${totalCapital ? 'sideStat__value--lime' : 'sideStat__value--none'}`}>
                  {totalCapital ? `+${pct(blendedCarry)}` : 'No position'}
                </span>
                <span className="mono-label sideStat__caption">
                  {totalCapital ? 'ESTIMATE, NOT GUARANTEED' : 'DEPLOY CAPITAL TO SEE CARRY'}
                </span>
              </div>
            </div>
            <div className="sideStat">
              <div>
                <span className="mono-label">RISK BUDGET</span>
                <span className="sideStat__value">
                  {riskBudget}
                  <span className="sideStat__sub"> / 100</span>
                </span>
                <span className="sideStat__bar" aria-hidden="true">
                  <span style={{ width: `${riskBudget}%` }} />
                </span>
              </div>
            </div>
            <div className="sideStat">
              <div>
                <span className="mono-label">NEXT CHECK</span>
                <span className="sideStat__value sideStat__value--mono">{agentPaused ? '—:—:—' : countdown}</span>
                <span className="mono-label sideStat__caption">{agentPaused ? 'MONITORING PAUSED' : 'AUTOMATIC RESCAN'}</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="vaultPage__scene">
          <ScenePlate scene="kaji-vault" className="vaultPage__plate">
            {active.length > 0 && (
              <>
                <div className="infeedLabels" aria-hidden="true">
                  {allocation.slice(0, 3).map((a) => (
                    <span key={a.label}>
                      {a.label.toUpperCase()}
                      <em>INFEED →</em>
                    </span>
                  ))}
                </div>
                <span className="vaultPage__netCarryTag" aria-hidden="true">
                  NET CARRY
                </span>
              </>
            )}
          </ScenePlate>

          {active.length > 0 ? (
            <div className="allocationRail">
              <span className="mono-label allocationRail__title">NATIVE ALLOCATION</span>
              <div className="allocationRail__cells">
                {allocation.map((a) => (
                  <div key={a.label} className="allocCell">
                    <div className="allocCell__body">
                      <div className="allocCell__row">
                        <span className="mono-label">{a.label.toUpperCase()}</span>
                        <span className="allocCell__pct">{a.pct}%</span>
                      </div>
                      <span className="allocCell__bar" aria-hidden="true">
                        <span style={{ width: `${a.pct}%` }} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="vaultPage__emptyWrap">
              <EmptyState
                title="Nothing on the line"
                body="Once you approve a recipe, the position appears here with its live health, its allocation and every action the agent takes on it."
                action={
                  <Link to="/opportunities" className="btn-lime">
                    OPEN THE SCANNER <span aria-hidden="true">→</span>
                  </Link>
                }
              />
            </div>
          )}
        </div>
      </div>

      {active.length > 0 && (
        <section className="positionTable" aria-label="Open positions">
          <div className="positionTable__head">
            <span className="mono-label">POSITION</span>
            <span className="mono-label">CAPITAL</span>
            <span className="mono-label">ENTRY CARRY</span>
            <span className="mono-label">CURRENT</span>
            <span className="mono-label">RISK</span>
            <span className="mono-label">OPENED</span>
            <span className="visually-hidden">Action</span>
          </div>
          {active.map((p) => (
            <div key={p.id} className="positionTable__row">
              <span className="positionTable__name">
                {p.recipe_name}
                {p.tx_hash.startsWith('demo') && <span className="positionTable__demo mono-label">DEMO</span>}
              </span>
              <span className="positionTable__cell">{usd(p.capital_usd)}</span>
              <span className="positionTable__cell">{pct(p.entry_net_carry)}</span>
              <span className="positionTable__cell positionTable__cell--lime">{pct(p.current_net_carry)}</span>
              <span className="positionTable__cell">{p.risk_score}/100</span>
              <span className="positionTable__cell">{relativeTime(p.opened_at)}</span>
              <button className="positionTable__close" onClick={() => closePosition(p.id)}>
                {canSign ? 'WITHDRAW' : 'CLOSE'}
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="vaultPage__bottom">
        <div className="activityTable">
          <div className="activityTable__head">
            <span className="mono-label">ACTIVITY</span>
            <span className="mono-label">DETAILS</span>
            <span className="mono-label">TIME</span>
            <span className="mono-label">STATUS</span>
          </div>
          {events.length === 0 && (
            <p className="activityTable__empty">
              No agent activity yet. Every scan, recommendation and executed action is logged here.
            </p>
          )}
          {events.slice(0, 8).map((e) => (
            <div key={e.id} className="activityTable__row">
              <span className="activityTable__activity">{e.title}</span>
              <span className="activityTable__detail">{e.detail}</span>
              <span className="activityTable__time">{relativeTime(e.at)}</span>
              <span className={`activityTable__status activityTable__status--${e.kind}`}>
                <span
                  className={`dot ${e.kind === 'pending' || e.kind === 'paused' ? 'dot--amber' : e.kind === 'skipped' ? 'dot--grey' : ''}`}
                  aria-hidden="true"
                />
                {e.kind.toUpperCase()}
              </span>
            </div>
          ))}
        </div>

        <div className="vaultPage__actions">
          {pending.length > 0 ? (
            <button className="vaultPage__review" onClick={() => resolveEvent(pending[0].id, 'executed')}>
              REVIEW NEXT ACTION <span aria-hidden="true">→</span>
            </button>
          ) : (
            <div className="vaultPage__noAction">
              <span className="mono-label">NO ACTION PENDING</span>
              <p>Everything is inside your mandate. The agent will surface the next recommendation here.</p>
            </div>
          )}
          <button
            className={`vaultPage__pause ${agentPaused ? 'vaultPage__pause--resume' : ''}`}
            onClick={() => setPaused(!agentPaused)}
          >
            {agentPaused ? 'RESUME AGENT' : 'PAUSE AGENT'}
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              {agentPaused ? (
                <path d="M3 2l11 6-11 6z" fill="currentColor" />
              ) : (
                <>
                  <rect x="3" y="2" width="4" height="12" fill="currentColor" />
                  <rect x="9" y="2" width="4" height="12" fill="currentColor" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
    </AppShell>
  )
}
