import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { isAddress } from 'viem'
import ScenePlate from '../components/ScenePlate'
import { AppShell } from '../components/AppShell'
import { EmptyState, relativeTime } from '../components/ui'
import { useWalletGate } from '../components/Wallet'
import { readOwnerPositions } from '../lib/adapters'
import { IS_LIVE_CHAIN } from '../lib/chain'
import { DEFAULT_MANDATE } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import './Vault.css'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number) => `${(n * 100).toFixed(2)}%`

export default function Vault() {
  const { positions, events, mandate, totalCapital, blendedCarry, closePosition, resolveEvent } =
    useAgent()
  const { canSign, address: connected } = useWalletGate()

  /**
   * The route names whose vault this is. `me` resolves to the connected wallet;
   * an explicit address lets anyone inspect a position without connecting.
   */
  const { address: routeAddress } = useParams()
  const owner = (
    routeAddress && routeAddress !== 'me' && isAddress(routeAddress) ? routeAddress : connected
  ) as `0x${string}` | undefined
  const isOwnVault = Boolean(owner && connected && owner.toLowerCase() === connected.toLowerCase())

  /**
   * What the chain says this wallet holds. The local event log only records what
   * this browser did — a deposit made elsewhere is still this wallet's position.
   */
  const { data: onchain, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ['owner-positions', owner],
    queryFn: () => readOwnerPositions(owner as `0x${string}`),
    enabled: Boolean(owner) && IS_LIVE_CHAIN,
    staleTime: 30_000,
  })

  const onchainValueUsd = useMemo(() => (onchain ?? []).reduce((s, p) => s + p.valueUsd, 0), [onchain])

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
          {/* "LIVE" would claim a background monitor this build does not run.
              The policy engine is armed on every action you take here; nothing
              watches the position while this tab is closed. */}
          <div className="agentStatus mono-label">
            POLICY ENGINE <span className="dot" aria-hidden="true" />{' '}
            <span className="agentStatus__live">ARMED</span>
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
              ? `PONSAJI checks ${active.length} position${active.length > 1 ? 's' : ''} against your mandate every time this page reads the chain. Checks run here, not in the background.`
              : 'No capital deployed. Nothing to check against your mandate yet.'}
          </p>

          <div className="sideStats">
            <div className="sideStat">
              <div>
                <span className="mono-label">DEPLOYED CAPITAL</span>
                {/* Chain first: vault shares this wallet actually holds. Local
                    state is only the fallback when there is nothing to read. */}
                <span className="sideStat__value">{usd(onchain?.length ? onchainValueUsd : totalCapital)}</span>
                <span className="sideStat__bar" aria-hidden="true">
                  <span
                    style={{ width: `${Math.min(100, ((onchain?.length ? onchainValueUsd : totalCapital) / cap) * 100)}%` }}
                  />
                </span>
                <span className="mono-label sideStat__caption">
                  {onchain?.length ? `${usd(cap)} CAP · ONCHAIN` : `${usd(cap)} MANDATE CAP`}
                </span>
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
                {/* This build has no background process, so a countdown to an
                    "automatic rescan" would be a clock that leads to nothing.
                    What is true is when the chain was last read, and that the
                    reader is one click away. */}
                <span className="mono-label">VAULT READ</span>
                <span className="sideStat__value sideStat__value--mono">
                  {!owner ? '—' : isFetching ? 'READING…' : dataUpdatedAt ? relativeTime(dataUpdatedAt) : '—'}
                </span>
                <button
                  className="mono-label sideStat__caption sideStat__refresh"
                  onClick={() => refetch()}
                  disabled={!owner || isFetching}
                >
                  {owner ? 'RE-READ CHAIN' : 'CONNECT TO READ'}
                </button>
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
                title={onchain?.length ? 'Held onchain, not opened here' : 'Nothing on the line'}
                body={
                  onchain?.length
                    ? 'This wallet holds vault shares that were not opened in this browser. They are listed below, read straight from the vault contracts.'
                    : 'Once you approve a recipe, the position appears here with its health and allocation, re-read from the chain each time you open this page.'
                }
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

      {/* What the chain says this wallet owns, independent of anything this
          browser recorded. */}
      {onchain && onchain.length > 0 && (
        <section className="positionTable" aria-label="Onchain vault holdings">
          <div className="positionTable__head">
            <span className="mono-label">ONCHAIN HOLDING</span>
            <span className="mono-label">VALUE</span>
            <span className="mono-label">SHARES</span>
            <span className="mono-label">VAULT maxWithdraw</span>
            <span className="mono-label">ASSET</span>
            <span className="mono-label">SOURCE</span>
            <span className="visually-hidden">Action</span>
          </div>
          {onchain.map((p) => (
            <div key={p.vault_address} className="positionTable__row">
              <span className="positionTable__name">{p.recipe_name}</span>
              <span className="positionTable__cell">{usd(p.valueUsd)}</span>
              <span className="positionTable__cell">{Number(p.shares) / 10 ** 18 < 0.01 ? '<0.01' : (Number(p.shares) / 10 ** 18).toFixed(2)}</span>
              <span className="positionTable__cell">
                {p.maxWithdrawUsd === null ? 'NOT REPORTED' : usd(p.maxWithdrawUsd)}
              </span>
              <span className="positionTable__cell">{p.assetSymbol}</span>
              <span className="positionTable__cell positionTable__cell--lime">VAULT CONTRACT</span>
              <Link className="positionTable__inspect" to={`/recipes/${p.recipe_id}`}>
                INSPECT
              </Link>
            </div>
          ))}
          <p className="positionTable__note">
            Read from each vault&apos;s <code>balanceOf</code> and <code>convertToAssets</code>
            {dataUpdatedAt ? ` · ${relativeTime(dataUpdatedAt)}` : ''}
            {isOwnVault ? '' : ' · viewing another wallet'}
          </p>
          {onchain.some((p) => p.maxWithdrawUsd === 0) && (
            <p className="positionTable__note positionTable__note--caution">
              <code>maxWithdraw</code> is the vault contract&apos;s own answer for this wallet. These Vault V2
              deployments return 0 for every holder PONSAJI has read, so treat it as &ldquo;not exposed by the
              contract&rdquo; rather than as a statement about your money. The exit-depth figure on the scanner comes
              from a different source and is labelled separately.
            </p>
          )}
        </section>
      )}

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
              Nothing recorded yet. Every mandate change and position you open or close is logged here.
            </p>
          )}
          {events.slice(0, 8).map((e) => (
            <div key={e.id} className="activityTable__row">
              <span className="activityTable__activity">{e.title}</span>
              <span className="activityTable__detail">{e.detail}</span>
              <span className="activityTable__time">{relativeTime(e.at)}</span>
              <span className={`activityTable__status activityTable__status--${e.kind}`}>
                <span
                  className={`dot ${e.kind === 'pending' ? 'dot--amber' : e.kind === 'skipped' ? 'dot--grey' : ''}`}
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
              <p>Everything is inside your mandate. Anything that falls outside it will be listed here.</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
