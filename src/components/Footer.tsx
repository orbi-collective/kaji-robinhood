import { Link } from 'react-router-dom'
import { CHAIN_ID, CHAIN_NAME, explorerAddress } from '../lib/chain'
import { NAV_LINKS } from './TopNav'
import { PONSAJI_TOKEN, isLaunched } from '../lib/ponsajiToken'
import './Footer.css'

/**
 * The footer.
 *
 * Built as a machined plate rather than a row of links, because the two things
 * it exists to carry — the contract address and the account — do not exist yet,
 * and a footer that shrugs at that reads as unfinished. Instead the plate has
 * the slots stamped and empty, which is a state this product already has a
 * visual language for.
 *
 * Neither pending slot is an anchor. A control that looks pressable and does
 * nothing is the same lie as a number that looks measured and is not.
 */

/** The account. Null again would render the slot as pending, not as a dead link. */
const X_HANDLE: string | null = 'getponsaji'

export default function Footer() {
  const ca = PONSAJI_TOKEN.address

  return (
    <footer className="siteFooter">
      <div className="siteFooter__grid">
        <div className="siteFooter__brand">
          <span className="siteFooter__mark">PONSAJI</span>
          <p className="siteFooter__blurb">
            Hold {PONSAJI_TOKEN.symbol}, earn {PONSAJI_TOKEN.payoutAsset.symbol}. Paid for time actually held, not for
            holding at the right second.
          </p>
          <span className="mono-label siteFooter__chain">
            {CHAIN_NAME.toUpperCase()} · CHAIN {CHAIN_ID}
          </span>
        </div>

        <nav className="siteFooter__nav" aria-label="Footer">
          <span className="mono-label siteFooter__navHead">THE TOKEN</span>
          <Link to="/docs#how">How it works</Link>
          <Link to="/docs#ledger">The ledger</Link>
        </nav>

        <nav className="siteFooter__nav" aria-label="Footer instrument">
          <span className="mono-label siteFooter__navHead">THE INSTRUMENT</span>
          {NAV_LINKS.filter((l) => l.to !== '/docs').map((l) => (
            <Link key={l.to} to={l.to}>
              {l.label.charAt(0) + l.label.slice(1).toLowerCase()}
            </Link>
          ))}
        </nav>

        {/* The issue plate: slots stamped, values pending. */}
        <div className="issuePlate" aria-label="Token identifiers">
          <span className="issuePlate__rivet issuePlate__rivet--tl" aria-hidden="true" />
          <span className="issuePlate__rivet issuePlate__rivet--tr" aria-hidden="true" />
          <span className="issuePlate__rivet issuePlate__rivet--bl" aria-hidden="true" />
          <span className="issuePlate__rivet issuePlate__rivet--br" aria-hidden="true" />

          <div className="issueRow">
            <span className="issueRow__key mono-label">CA</span>
            {isLaunched() && ca ? (
              <a className="issueRow__val" href={explorerAddress(ca)} target="_blank" rel="noopener noreferrer">
                {ca.slice(0, 10)}…{ca.slice(-8)} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="issueRow__pending">
                <span className="issueRow__dot" aria-hidden="true" />
                NOT DEPLOYED
              </span>
            )}
          </div>

          <div className="issueRow">
            <span className="issueRow__key mono-label">X</span>
            {X_HANDLE ? (
              <a
                className="issueRow__val"
                href={`https://x.com/${X_HANDLE}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                @{X_HANDLE} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="issueRow__pending">
                <span className="issueRow__dot" aria-hidden="true" />
                SOON
              </span>
            )}
          </div>

          <div className="issueRow">
            <span className="issueRow__key mono-label">PAID IN</span>
            <a
              className="issueRow__val"
              href={explorerAddress(PONSAJI_TOKEN.payoutAsset.address)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {PONSAJI_TOKEN.payoutAsset.symbol} <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </div>

      <p className="siteFooter__legal">
        Nothing here is a promise or financial advice. The account holds whatever trading has put in it, which may be a
        great deal or nothing at all. Onchain positions carry loss, liquidity and smart-contract risk, and the tokenized
        stock this pays in is issued by a third party on an upgradeable, pausable contract, and that risk passes through.
      </p>
    </footer>
  )
}
