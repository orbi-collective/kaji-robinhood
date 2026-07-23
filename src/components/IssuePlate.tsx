import { useState } from 'react'
import './IssuePlate.css'

/**
 * Token issue plate.
 *
 * Styled as the riveted serial plate already bolted to KJ-01 rather than the
 * usual glowing contract pill — it belongs to this machine's own visual world.
 *
 * Lime is reserved for live signal, so a pending field stays steel. The moment
 * an address or link exists, pass it and the row becomes copyable / clickable
 * and takes the signal colour.
 */

export type PlateField = {
  label: string
  /** Present once it exists. Absent renders the pending state. */
  value?: string
  /** Renders the value as a link instead of a copy target. */
  href?: string
}

function CopyRow({ field }: { field: PlateField }) {
  const [copied, setCopied] = useState(false)

  if (!field.value) {
    return (
      <div className="issuePlate__row">
        <span className="issuePlate__label">{field.label}</span>
        <span className="issuePlate__pending">
          <span className="issuePlate__pendingDot" aria-hidden="true" />
          SOON
        </span>
      </div>
    )
  }

  if (field.href) {
    return (
      <div className="issuePlate__row">
        <span className="issuePlate__label">{field.label}</span>
        <a className="issuePlate__value" href={field.href} target="_blank" rel="noopener noreferrer">
          {field.value}
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    )
  }

  return (
    <div className="issuePlate__row">
      <span className="issuePlate__label">{field.label}</span>
      <button
        className="issuePlate__value"
        onClick={() => {
          navigator.clipboard?.writeText(field.value ?? '').catch(() => {})
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        aria-label={`Copy ${field.label} ${field.value}`}
      >
        <span className="issuePlate__valueText">{field.value}</span>
        <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      </button>
      <span aria-live="polite" className="visually-hidden">
        {copied ? `${field.label} copied` : ''}
      </span>
    </div>
  )
}

export default function IssuePlate({ fields }: { fields: PlateField[] }) {
  return (
    <div className="issuePlate">
      <span className="issuePlate__rivet issuePlate__rivet--tl" aria-hidden="true" />
      <span className="issuePlate__rivet issuePlate__rivet--tr" aria-hidden="true" />
      <span className="issuePlate__rivet issuePlate__rivet--bl" aria-hidden="true" />
      <span className="issuePlate__rivet issuePlate__rivet--br" aria-hidden="true" />
      {fields.map((f) => (
        <CopyRow key={f.label} field={f} />
      ))}
    </div>
  )
}
