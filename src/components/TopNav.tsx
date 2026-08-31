import { Link, useLocation } from 'react-router-dom'
import { CHAIN_NAME } from '../lib/chain'
import { WalletButton } from './Wallet'
import './TopNav.css'

/**
 * The only navigation in the product.
 *
 * Landing and the app shell differ in exactly one thing — the right-hand action,
 * because a visitor needs a way in and an operator needs their wallet. Links,
 * labels, order, brand, height and states are shared so the same destination is
 * never called two different things.
 */

/**
 * `owns` lists the route prefixes a tab is responsible for, so inspecting a
 * recipe keeps SCANNER lit — you reached it from there and haven't left that
 * part of the product.
 */
export const NAV_LINKS = [
  { label: 'PAYOUT', to: '/payout', owns: ['/payout'] },
  { label: 'SCANNER', to: '/opportunities', owns: ['/opportunities', '/recipes'] },
  { label: 'VAULT', to: '/vaults/me', owns: ['/vaults'] },
  { label: 'SECURITY', to: '/security', owns: ['/security'] },
  // Reference material, so it sits at the end rather than in the middle of the
  // things you can act on.
  { label: 'DOCS', to: '/docs', owns: ['/docs', '/mechanics', '/payroll'] },
] as const

export default function TopNav({ variant = 'app' }: { variant?: 'app' | 'landing' }) {
  const { pathname } = useLocation()

  return (
    <header className={`topNav topNav--${variant}`}>
      <Link to="/" className="topNav__brand" aria-label="PONSAJI home">
        <img
          className="topNav__brandMark"
          src="/assets/ponsaji-mark.png"
          width="38"
          height="38"
          alt=""
          aria-hidden="true"
        />
        <span className="topNav__brandName">PONSAJI</span>
        <span className="topNav__brandSuffix">CARRY FOUNDRY</span>
      </Link>

      <nav className="topNav__links" aria-label="Primary">
        {NAV_LINKS.map((l) => {
          const active = l.owns.some((p) => pathname === p || pathname.startsWith(`${p}/`))
          return (
            <Link
              key={l.to}
              to={l.to}
              className={`topNav__link ${active ? 'topNav__link--active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              {l.label}
            </Link>
          )
        })}
      </nav>

      <div className="topNav__right">
        {/* X link is intentionally omitted until the handle is confirmed —
            an icon pointing at a placeholder handle is worse than none. */}
        {variant === 'landing' ? (
          <>
            <span className="topNav__chain">
              <span className="topNav__chainLabel">BUILT ON</span>
              <span className="topNav__chainName">
                {CHAIN_NAME.toUpperCase()}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M17 3c-4 0-8.5 2.4-10.6 7.1-1.4 3.2-1.5 6.9-1.4 8.9.6-2.6 2-5.9 4.3-8.2-.7 2.2-.8 4.8-.3 6.6C10.4 15 13.6 12 15 8.6c-.4 2.2-1.4 4.6-2.7 6.3 2.6-1.3 4.9-3.9 5.9-7.4.5-1.8.6-3.4.5-4.4-.5-.1-1.1-.1-1.7-.1Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
            </span>
            <Link to="/docs" className="topNav__cta">
              HOW IT WORKS <span aria-hidden="true">→</span>
            </Link>
          </>
        ) : (
          <WalletButton />
        )}
      </div>
    </header>
  )
}
