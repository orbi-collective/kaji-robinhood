import { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { explorerTx, wagmiConfig } from '../lib/chain'
import { approvalRequest, depositRequest, planDeposit, simulateDeposit } from '../lib/deposit'
import type { PreparedTransaction } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import { Dialog, VerdictTag } from './ui'
import { useWalletGate } from './Wallet'
import './TxPreview.css'

type Phase = 'review' | 'planning' | 'approving' | 'simulating' | 'signing' | 'confirming' | 'submitted' | 'failed'

const BUSY_COPY: Partial<Record<Phase, string>> = {
  planning: 'CHECKING BALANCE & ALLOWANCE…',
  approving: 'APPROVE SPEND IN WALLET…',
  simulating: 'SIMULATING AGAINST CURRENT STATE…',
  signing: 'CONFIRM DEPOSIT IN WALLET…',
  confirming: 'WAITING FOR CONFIRMATION…',
}

/** Turns wallet/RPC errors into something a person can act on. */
function readableError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/User rejected|denied transaction|User denied/i.test(msg))
    return 'You rejected the request in your wallet. Nothing was signed and no funds moved.'
  if (/insufficient funds/i.test(msg)) return 'Not enough ETH to cover gas on this network.'
  if (/exceeds balance|short of this allocation/i.test(msg)) return msg
  return msg.split('\n')[0].slice(0, 220)
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`
const pct = (n: number) => `${(n * 100).toFixed(2)}%`

/**
 * The last thing a user sees before signing. It states the exact action, the
 * policy verdict per check, and the estimate's assumptions — never a bare
 * "Confirm" button.
 */
export default function TxPreview({
  open,
  onClose,
  tx,
}: {
  open: boolean
  onClose: () => void
  tx: PreparedTransaction | null
}) {
  const titleId = useId()
  const navigate = useNavigate()
  const { addPosition } = useAgent()
  const { address, canSign, blockedReason } = useWalletGate()
  const [phase, setPhase] = useState<Phase>('review')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const { writeContractAsync } = useWriteContract()

  const busy = Boolean(BUSY_COPY[phase])

  useEffect(() => {
    if (open) {
      setPhase('review')
      setError(null)
      setTxHash(null)
    }
  }, [open])

  if (!tx) return null

  const blocked = tx.policy.verdict === 'block'
  const totalUsd = tx.steps.reduce((s, step) => s + step.amount_usd, 0)

  function openPosition(txHash: string) {
    if (!tx) return
    addPosition({
      id: `${tx.recipe_id}-${Date.now()}`,
      recipe_id: tx.recipe_id,
      recipe_name: tx.recipe_name,
      capital_usd: tx.capital_usd,
      entry_net_carry: tx.simulation.net_carry,
      current_net_carry: tx.simulation.net_carry,
      risk_score: tx.risk_score,
      status: 'active',
      tx_hash: txHash,
      opened_at: Date.now(),
      allocation: tx.steps.map((s) => ({
        label: s.action.split(' ')[0],
        venue: s.venue,
        weight: Math.round((s.amount_usd / (tx.capital_usd || 1)) * 100),
      })),
    })
    setPhase('submitted')
  }

  /**
   * Live path: the wallet is the only signer. Allowance first when short, then
   * the deposit — each simulated before it is offered for signature.
   */
  async function sign() {
    if (!tx || !address) return
    setError(null)
    try {
      setPhase('planning')
      const plan = await planDeposit(tx.recipe_id, tx.capital_usd, address)

      if (plan.needsApproval) {
        setPhase('approving')
        const approvalHash = await writeContractAsync(approvalRequest(plan))
        await waitForTransactionReceipt(wagmiConfig, { hash: approvalHash })
      }

      // Reverts here cost nothing — the wallet has not been asked yet.
      setPhase('simulating')
      await simulateDeposit(plan, address)

      setPhase('signing')
      const hash = await writeContractAsync(depositRequest(plan, address))
      setPhase('confirming')
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash })
      if (receipt.status !== 'success') throw new Error('Transaction reverted onchain. No position was opened.')

      setTxHash(hash)
      openPosition(hash)
    } catch (e) {
      setError(readableError(e))
      setPhase('failed')
    }
  }

  /** Demo path: records a position locally so the monitoring flow is walkable.
   *  Never claims a signature — the button and the resulting position say DEMO. */
  function recordDemo() {
    openPosition('demo-no-onchain-transaction')
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} className="txPreview">
      <header className="txPreview__head">
        <div>
          <span className="mono-label">TRANSACTION PREVIEW</span>
          <h2 id={titleId} className="txPreview__title">
            {tx.recipe_name}
          </h2>
        </div>
        <VerdictTag verdict={tx.policy.verdict}>
          {blocked ? 'POLICY BLOCK' : tx.policy.verdict === 'review' ? 'NEEDS REVIEW' : 'POLICY PASS'}
        </VerdictTag>
      </header>

      <div className="txPreview__body">
        {phase === 'submitted' ? (
          <div className="txPreview__done" role="status">
            <h3 className="txPreview__doneTitle">{canSign ? 'Position opened' : 'Demo position recorded'}</h3>
            <p>
              {tx.recipe_name} {canSign ? 'funded with' : 'recorded at'} {usd(tx.capital_usd)}. The agent now monitors it
              against your mandate and pauses if the recipe leaves bounds.
              {!canSign && ' No transaction was signed and no funds moved.'}
            </p>
            {txHash && (
              <a className="txPreview__hash" href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer">
                VIEW ON EXPLORER <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>
        ) : (
          <>
            <section className="txPreview__section">
              <h3 className="txPreview__h3">What the wallet is asked to do</h3>
              <ol className="txSteps">
                {tx.steps.map((step, i) => (
                  <li key={`${step.venue}-${i}`} className="txStep">
                    <span className="txStep__index">{String(i + 1).padStart(2, '0')}</span>
                    <span className="txStep__action">{step.action}</span>
                    <span className="txStep__venue mono-label">{step.venue}</span>
                    <span className="txStep__amount">{usd(step.amount_usd)}</span>
                  </li>
                ))}
              </ol>
              <div className="txPreview__totals">
                <span className="mono-label">TOTAL COMMITTED</span>
                <span className="txPreview__total">{usd(totalUsd)}</span>
                <span className="mono-label">EST. GAS</span>
                <span className="txPreview__gas">{usd(tx.estimated_gas_usd)}</span>
              </div>
            </section>

            <section className="txPreview__section">
              <h3 className="txPreview__h3">Policy checks</h3>
              <ul className="txChecks">
                {tx.policy.checks.map((c) => (
                  <li key={c.id} className={`txCheck txCheck--${c.verdict}`}>
                    <VerdictTag verdict={c.verdict} />
                    <span className="txCheck__label">{c.label}</span>
                    <span className="txCheck__detail">{c.detail}</span>
                    <span className="txCheck__bound mono-label">
                      {c.observed} <span className="txCheck__vs">vs</span> {c.bound}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="txPreview__section">
              <h3 className="txPreview__h3">Estimate and assumptions</h3>
              <dl className="txAssumptions">
                <div>
                  <dt className="mono-label">EST. NET CARRY</dt>
                  <dd className="txAssumptions__lime">{pct(tx.simulation.net_carry)}</dd>
                </div>
                <div>
                  <dt className="mono-label">GROSS APY</dt>
                  <dd>{pct(tx.simulation.gross_apy)}</dd>
                </div>
                <div>
                  <dt className="mono-label">SIM. MAX DRAWDOWN</dt>
                  <dd>{tx.simulation.max_drawdown_pct.toFixed(2)}%</dd>
                </div>
                <div>
                  <dt className="mono-label">REALIZABLE EXIT</dt>
                  <dd>{usd(Math.round(tx.simulation.realizable_exit_usd))}</dd>
                </div>
              </dl>
              <p className="txPreview__disclosure">
                Estimate only, not guaranteed. Simulated {new Date(tx.simulation.simulated_at).toLocaleTimeString()} against
                the state at preparation time. Onchain strategies involve loss, liquidity, oracle and smart-contract risk.
              </p>
            </section>

            {(blockedReason || error) && (
              <p className={`txPreview__notice ${error ? 'txPreview__notice--error' : ''}`} role="alert">
                {error ?? blockedReason}
              </p>
            )}
            {blocked && (
              <p className="txPreview__notice txPreview__notice--error" role="alert">
                The policy engine blocked this action. Adjust the mandate or the allocation — Kaji will not prepare a
                transaction that violates it.
              </p>
            )}
          </>
        )}
      </div>

      <footer className="txPreview__foot">
        {phase === 'submitted' ? (
          <>
            <button className="btn-outline" onClick={onClose}>
              CLOSE
            </button>
            <button
              className="btn-lime"
              onClick={() => {
                onClose()
                navigate(`/vaults/${address ?? 'demo'}`)
              }}
            >
              VIEW POSITION <span aria-hidden="true">→</span>
            </button>
          </>
        ) : (
          <>
            <button className="btn-outline" onClick={onClose} disabled={busy}>
              CANCEL
            </button>
            {canSign ? (
              <button className="btn-lime" onClick={sign} disabled={blocked || busy}>
                {BUSY_COPY[phase] ?? 'REVIEW IN WALLET'} <span aria-hidden="true">→</span>
              </button>
            ) : (
              <button
                className="btn-outline txPreview__demoBtn"
                onClick={recordDemo}
                disabled={blocked}
                aria-describedby={`${titleId}-blocked`}
              >
                RECORD AS DEMO POSITION
              </button>
            )}
          </>
        )}
      </footer>
      {blockedReason && (
        <span id={`${titleId}-blocked`} className="visually-hidden">
          {blockedReason}
        </span>
      )}
    </Dialog>
  )
}
