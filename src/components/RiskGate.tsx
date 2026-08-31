import { useEffect, useRef, useState } from 'react'
import './RiskGate.css'

/**
 * First-visit acknowledgement.
 *
 * PONSAJI reads mainnet and prepares real transactions, so the risks belong in
 * front of the product rather than in a footer line under it. The gate states
 * what the product is, what it cannot do, and what can go wrong — then gets out
 * of the way permanently.
 *
 * It is not a consent wall for anyone else's terms: nothing here is submitted
 * anywhere, and the acknowledgement lives only in this browser.
 */

const STORAGE_KEY = 'ponsaji.risk.ack.v1'

const POINTS = [
  {
    title: 'PONSAJI is an instrument, not a manager',
    body: 'It reads contracts, prices positions and checks them against limits you set. It never takes custody, never signs, and runs no background process. Nothing is monitored while this tab is closed.',
  },
  {
    title: 'Every figure is an estimate carrying its inputs',
    body: 'Numbers are read from contracts and labelled with their source and age. Where a value cannot be measured it is shown as unknown rather than filled in. Estimates are not promises.',
  },
  {
    title: 'Distribution income is a share of trading volume',
    body: 'The fee-distribution venues on this chain pay holders out of other people’s trades. That income decays when trading slows, and one venue pays nothing at all to plain holders. PONSAJI states break-even under three decay regimes for exactly this reason.',
  },
  {
    title: 'You can lose everything you commit',
    body: 'Onchain positions carry loss, liquidity, oracle and smart-contract risk. Tokenized stocks are issued by third parties on upgradeable contracts, and that risk passes through. Never commit more than you can afford to lose completely.',
  },
]

export default function RiskGate() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  const acceptRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true)
    } catch {
      // Storage blocked (private mode). Showing the gate each visit is the
      // safer failure than silently skipping it.
      setOpen(true)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      acceptRef.current?.focus()
    }
    if (!open && el.open) el.close()
  }, [open])

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()))
    } catch {
      /* acknowledged for this session only */
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <dialog
      ref={ref}
      className="riskGate"
      aria-labelledby="riskgate-title"
      // The gate has one way out. Dismissing with Escape would leave it
      // unacknowledged while the product ran anyway.
      onCancel={(e) => e.preventDefault()}
    >
      <div className="riskGate__inner">
        <span className="mono-label riskGate__eyebrow">BEFORE YOU USE PONSAJI</span>
        <h2 id="riskgate-title" className="riskGate__title">
          Read this once<span className="lime-period">.</span>
        </h2>

        <ul className="riskGate__list">
          {POINTS.map((p) => (
            <li key={p.title} className="riskGate__item">
              <h3 className="riskGate__itemTitle">{p.title}</h3>
              <p className="riskGate__itemBody">{p.body}</p>
            </li>
          ))}
        </ul>

        <button ref={acceptRef} className="btn-lime riskGate__accept" onClick={accept}>
          I UNDERSTAND <span aria-hidden="true">→</span>
        </button>
        <p className="riskGate__foot">
          Nothing here is financial advice. This acknowledgement is stored in this browser only and is not sent anywhere.
        </p>
      </div>
    </dialog>
  )
}
