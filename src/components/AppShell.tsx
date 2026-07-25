import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CHAIN_ID, CHAIN_NAME, IS_LIVE_CHAIN } from '../lib/chain'
import { useAgent } from '../state/AgentStore'
import TopNav from './TopNav'
import './AppShell.css'

/**
 * Shared chrome for every authenticated surface: one nav, one wallet control,
 * one demo-mode banner. Landing renders its own hero nav instead.
 */
export function AppShell({ children, plate }: { children: ReactNode; plate?: ReactNode }) {
  const { agentPaused, killSwitchAt } = useAgent()

  return (
    <div className="appShell">
      {plate}
      <a className="skipLink" href="#main">
        Skip to content
      </a>

      <TopNav />

      {!IS_LIVE_CHAIN && (
        <p className="modeBanner" role="status">
          <span className="modeBanner__tag">DEMO DATA</span>
          No {CHAIN_NAME} endpoint is configured for this build. Every estimate below is reference data and no
          transaction can be signed.
        </p>
      )}

      {IS_LIVE_CHAIN && (
        <p className="modeBanner modeBanner--live" role="status">
          <span className="modeBanner__tag modeBanner__tag--live">MAINNET</span>
          Connected to {CHAIN_NAME} (chain {CHAIN_ID}). Deposits are real, non-custodial and signed by your wallet —
          rows marked DEMO are reference data with no live adapter yet.
        </p>
      )}

      {(agentPaused || killSwitchAt) && (
        <p className="pausedBanner" role="status">
          <span className="dot dot--amber" aria-hidden="true" />
          {killSwitchAt ? 'Emergency stop engaged — session access revoked.' : 'Agent paused — no actions are being prepared.'}{' '}
          <Link to="/security" className="pausedBanner__link">
            Review controls
          </Link>
        </p>
      )}

      <main id="main" tabIndex={-1} className="appShell__main">
        {children}
      </main>
    </div>
  )
}

/** Moves focus to the page heading on navigation so keyboard users don't restart at the top of the nav. */
export function RouteFocus() {
  const { pathname } = useLocation()
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const main = document.getElementById('main')
    main?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])

  return null
}

type BoundaryState = { error: Error | null }

/** Keeps a render failure on one surface from blanking the whole product. */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('SAJI render error', error, info)
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crashScreen" role="alert">
        <h1 className="crashScreen__title">The console dropped out.</h1>
        <p className="crashScreen__body">
          A surface failed to render. Nothing was signed and no funds moved — your mandate and positions are stored
          locally and will be here when you reload.
        </p>
        <div className="crashScreen__actions">
          <button className="btn-lime" onClick={() => window.location.reload()}>
            RELOAD
          </button>
          <Link to="/" className="btn-outline">
            BACK TO LANDING
          </Link>
        </div>
      </div>
    )
  }
}
