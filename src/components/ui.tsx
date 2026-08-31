import { useEffect, useRef, type ReactNode } from 'react'
import type { DataSource, PolicyVerdict } from '../lib/types'
import './ui.css'

/* ---------- data provenance ---------- */

const SOURCE_COPY: Record<DataSource, { label: string; title: string }> = {
  live: { label: 'LIVE', title: 'Read from venue contracts on this block' },
  delayed: { label: 'DELAYED', title: 'Cached venue read, refreshed on an interval' },
  demo: { label: 'DEMO', title: 'Reference data: no venue adapter configured for this build' },
}

export function SourceTag({ source, className }: { source: DataSource; className?: string }) {
  const copy = SOURCE_COPY[source]
  return (
    <span className={`sourceTag sourceTag--${source} ${className ?? ''}`} title={copy.title}>
      <span className={`dot ${source === 'demo' ? 'dot--grey' : ''}`} aria-hidden="true" />
      {copy.label}
    </span>
  )
}

/* ---------- verdicts ---------- */

const VERDICT_COPY: Record<PolicyVerdict, string> = {
  pass: 'OK',
  review: 'REVIEW',
  block: 'BLOCKED',
}

export function VerdictTag({ verdict, children }: { verdict: PolicyVerdict; children?: ReactNode }) {
  return (
    <span className={`verdictTag verdictTag--${verdict}`}>
      <span className={`dot ${verdict === 'review' ? 'dot--amber' : verdict === 'block' ? 'dot--red' : ''}`} aria-hidden="true" />
      {children ?? VERDICT_COPY[verdict]}
    </span>
  )
}

/* ---------- async surfaces ---------- */

export function Skeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton__row" style={{ animationDelay: `${i * 80}ms` }} aria-hidden="true" />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="emptyState">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" className="emptyState__mark">
        <rect x="3" y="9" width="28" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 15h28M11 9v18" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <h3 className="emptyState__title">{title}</h3>
      <p className="emptyState__body">{body}</p>
      {action}
    </div>
  )
}

export function ErrorState({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="errorState" role="alert">
      <h3 className="errorState__title">{title}</h3>
      <p className="errorState__body">{body}</p>
      {onRetry && (
        <button className="btn-outline" onClick={onRetry}>
          RETRY
        </button>
      )}
    </div>
  )
}

/* ---------- dialog ---------- */

/**
 * Native <dialog> so focus trapping, Esc and the top layer come from the
 * platform rather than a hand-rolled modal.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  labelledBy: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      // showModal focuses the first control, but a tall dialog can still open
      // scrolled past it — you land typing in a field that is off-screen above.
      // A panel opens at its beginning.
      el.scrollTop = 0
    }
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`dialog ${className ?? ''}`}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && children}
    </dialog>
  )
}

/* ---------- misc ---------- */

export function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86_400)}d ago`
}
