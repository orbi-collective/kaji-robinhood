import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ScenePlate from '../components/ScenePlate'
import TopNav from '../components/TopNav'
import Footer from '../components/Footer'
import { useWalletGate } from '../components/Wallet'
import { explorerAddress } from '../lib/chain'
import { relativeTime } from '../components/ui'
import { fetchOpportunities } from '../lib/adapters'
import { readPriceFeed } from '../lib/feeds'
import {
  isLaunched,
  projectPayroll,
  readDistributionHistory,
  readPayoutAssetPriceUsd,
  PONSAJI_TOKEN,
} from '../lib/ponsajiToken'
import './Landing.css'

/**
 * The landing page, and the product's front door.
 *
 * The token is the product; the scanner is the instrument that gives it its
 * credibility. So this page leads with what a holder gets and how, and treats
 * the measuring apparatus as the evidence rather than the offer.
 *
 * It follows the shape the incumbents use — a claim, a headline figure, the
 * last distribution, then the terms — because that shape is what a reader of
 * this meta already knows how to scan. Everything inside it is held to PONSAJI's
 * own standard: no figure appears that has not been read, and the pre-launch
 * state says so rather than showing a zero dressed as a result.
 */

const usd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function Landing() {
  const { address } = useWalletGate()

  const { data: state } = useQuery({
    queryKey: ['payroll'],
    queryFn: async ({ signal }) => {
      const eth = await readPriceFeed('ETH_USD').catch(() => null)
      return projectPayroll(eth?.price ?? null, signal)
    },
    enabled: isLaunched(),
    staleTime: 30_000,
  })

  // The scanner's own readings, used here as evidence rather than as a feature
  // list: the cost of every rival is a measurement this product already makes.
  const { data: venues } = useQuery({
    queryKey: ['opportunities'],
    queryFn: ({ signal }) => fetchOpportunities(signal),
  })

  // A live reading that exists even before the token does: what a holder will
  // be paid in, priced from its own pool.
  const { data: payoutPrice } = useQuery({
    queryKey: ['payout-price'],
    queryFn: () => readPayoutAssetPriceUsd(),
    staleTime: 60_000,
  })

  const rivals = useMemo(() => (venues ?? []).filter((v) => v.distribution), [venues])

  // What the account has actually sent, read from the chain rather than from a
  // tally this site keeps for itself.
  const { data: history } = useQuery({
    queryKey: ['distribution-history'],
    queryFn: ({ signal }) => readDistributionHistory(72, signal),
    staleTime: 120_000,
  })

  const mine = useMemo(
    () => state?.projected?.records.find((r) => r.wallet.toLowerCase() === address?.toLowerCase()) ?? null,
    [state, address],
  )


  return (
    <div className="tokenLanding">
      <a className="skipLink" href="#main">
        Skip to content
      </a>

      <main id="main" className="tokenLanding__main">
        {/* ---------- Hero: the foundry plate, with the token's claim over it ---------- */}
        <section className="foundryHero">
          <ScenePlate scene="kaji-foundry" mobileScene="kaji-foundry-mobile" className="foundryHero__plate" />
          <div className="foundryHero__scrim" aria-hidden="true" />

          <TopNav variant="landing" />

          <div className="hero__copy">
            <span className="mono-label hero__eyebrow">
              {PONSAJI_TOKEN.symbol} · ROBINHOOD CHAIN
            </span>
            <h1 className="hero__h1">
              Hold {PONSAJI_TOKEN.symbol}.
              <br />
              Earn stocks<span className="lime-period">.</span>
            </h1>
            <p className="hero__sub">
              Trading fees buy {PONSAJI_TOKEN.payoutAsset.symbol} and it is paid out to holders. Every venue like this
              pays on a snapshot of who held at one instant, so a wallet can buy seconds before it, take a full share,
              and sell. <strong>This one pays for time actually held.</strong>
            </p>

            <div className="hero__ctas">
              {isLaunched() ? (
                <a className="btn-lime hero__buy" href="https://ponslaunchpad.com" target="_blank" rel="noopener noreferrer">
                  BUY ${PONSAJI_TOKEN.symbol} <span aria-hidden="true">→</span>
                </a>
              ) : (
                <span className="hero__buy hero__buy--pending">
                  <span className="hero__pendingDot" aria-hidden="true" />
                  NOT DEPLOYED YET
                </span>
              )}
              <a className="btn-outline" href="#how">
                HOW IT WORKS
              </a>
            </div>
          </div>

          {/* ---------- The headline card ---------- */}
          <div className="board board--hero">
            <div className="board__head">
              <span className="mono-label">THE ACCOUNT</span>
              <span className={`board__state ${isLaunched() ? 'board__state--live' : ''}`}>
                {isLaunched() ? 'LIVE' : 'PRE-LAUNCH'}
              </span>
            </div>

            {isLaunched() ? (
              <>
                <div className="board__headline">
                  <span className="mono-label">IN THE ACCOUNT, TO BE DIVIDED</span>
                  <span className="board__big">
                    {state?.account ? `${state.account.units.toFixed(4)}` : '—'}
                    <span className="board__unit"> {PONSAJI_TOKEN.payoutAsset.symbol}</span>
                  </span>
                  <span className="board__sub">
                    {state?.accountUsd != null ? usd(state.accountUsd) : 'not priced'}
                    {PONSAJI_TOKEN.payrollAccount && (
                      <>
                        {' · '}
                        <a href={explorerAddress(PONSAJI_TOKEN.payrollAccount)} target="_blank" rel="noopener noreferrer">
                          {short(PONSAJI_TOKEN.payrollAccount)} ↗
                        </a>
                      </>
                    )}
                  </span>
                </div>
                <div className="board__grid">
                  <div>
                    <span className="mono-label">ON THE LEDGER</span>
                    <span className="board__cell">{state?.projected?.records.length ?? '—'}</span>
                  </div>
                  <div>
                    <span className="mono-label">CYCLE</span>
                    <span className="board__cell">{state?.cycle ? `#${state.cycle.index}` : '—'}</span>
                  </div>
                  <div>
                    <span className="mono-label">PAID IN</span>
                    <span className="board__cell">{PONSAJI_TOKEN.payoutAsset.symbol}</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="board__headline">
                  <span className="mono-label">NOTHING DISTRIBUTED YET</span>
                  <span className="board__big board__big--muted">
                    0<span className="board__unit"> {PONSAJI_TOKEN.payoutAsset.symbol}</span>
                  </span>
                  <span className="board__sub">
                    The token is not deployed. There is no account, no ledger and nothing to divide, so this reads zero
                    rather than borrowing a number from somewhere else.
                  </span>
                </div>
                <div className="board__grid">
                  <div>
                    <span className="mono-label">MECHANIC</span>
                    <span className="board__cell board__cell--sm">Service integral</span>
                  </div>
                  <div>
                    <span className="mono-label">CYCLE</span>
                    <span className="board__cell board__cell--sm">
                      {PONSAJI_TOKEN.cycleMinMinutes}–{PONSAJI_TOKEN.cycleMaxMinutes} min, seeded
                    </span>
                  </div>
                  <div>
                    <span className="mono-label">PAID IN</span>
                    <span className="board__cell board__cell--sm">{PONSAJI_TOKEN.payoutAsset.symbol}</span>
                  </div>
                </div>
              </>
            )}

            {mine && (
              <div className="board__mine">
                <span className="mono-label">YOUR SERVICE</span>
                <div className="board__mineRow">
                  <span>{mine.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })} {PONSAJI_TOKEN.symbol}</span>
                  <span>{mine.minutesHeld.toFixed(0)} min unbroken</span>
                  <span className="board__mineShare">{(mine.share * 100).toFixed(3)}% of the next run</span>
                </div>
              </div>
            )}
          </div>

          {/* Every reading on this rail is one this build actually took. The
              status cell is the one thing that is true before anything trades. */}
          <div className="instrumentRail" role="list" aria-label="Live readings">
            <div className="instrumentRail__cell" role="listitem">
              <span className="mono-label">STATUS</span>
              <div className="instrumentRail__row">
                <span className={`instrumentRail__value ${isLaunched() ? '' : 'instrumentRail__value--source'}`}>
                  {isLaunched() ? 'LIVE' : 'PRE-LAUNCH'}
                </span>
                {isLaunched() && <span className="instrumentRail__pulse" aria-hidden="true" />}
              </div>
            </div>
            <div className="instrumentRail__cell" role="listitem">
              <span className="mono-label">PAID IN</span>
              <div className="instrumentRail__row">
                <span className="instrumentRail__value">{PONSAJI_TOKEN.payoutAsset.symbol}</span>
                <span className="instrumentRail__sub">
                  {payoutPrice != null ? `$${payoutPrice.toFixed(2)}` : ''}
                </span>
              </div>
            </div>
            <div className="instrumentRail__cell" role="listitem">
              <span className="mono-label">CHEAPEST RIVAL ROUND TRIP</span>
              <div className="instrumentRail__row">
                <span className="instrumentRail__value instrumentRail__value--cost">
                  {rivals.length
                    ? `−${(Math.min(...rivals.map((r) => r.distribution!.entry_fee_bps + r.distribution!.exit_fee_bps)) / 100).toFixed(2)}%`
                    : '—'}
                </span>
                <span className="instrumentRail__sub">{rivals.length ? `${rivals.length} PRICED` : ''}</span>
              </div>
            </div>
            <div className="instrumentRail__cell" role="listitem">
              <span className="mono-label">YOU ARE PAID FOR</span>
              <div className="instrumentRail__row">
                <span className="instrumentRail__value instrumentRail__value--source">TIME HELD</span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- What has actually been paid ---------- */}
        <section className="fold fold--stats">
          <h2 className="fold__h2">
            The record
            <span className="lime-square" aria-hidden="true" />
          </h2>
          <p className="fold__intro">
            Every figure here is read from the payout asset&apos;s own Transfer logs, not from a file this site keeps.
            Anyone with the same logs computes the same table.
          </p>

          <div className="stats">
            <div className="stats__cell">
              <span className="mono-label">TOTAL DISTRIBUTED</span>
              <span className="stats__value stats__value--lime">
                {history ? history.totalUnits.toFixed(4) : '—'}
                <span className="stats__unit"> {PONSAJI_TOKEN.payoutAsset.symbol}</span>
              </span>
              <span className="stats__note">
                {history && history.totalUnits === 0
                  ? 'nothing sent yet'
                  : history?.totalUsd != null
                    ? usd(history.totalUsd)
                    : 'not priced'}
              </span>
            </div>
            <div className="stats__cell">
              <span className="mono-label">RUNS SETTLED</span>
              <span className="stats__value">{history ? history.runs : '—'}</span>
              <span className="stats__note">
                {history?.lastRunAt ? `last ${relativeTime(history.lastRunAt)}` : 'none yet'}
              </span>
            </div>
            <div className="stats__cell">
              <span className="mono-label">WALLETS PAID</span>
              <span className="stats__value">{history ? history.walletsPaid.toLocaleString('en-US') : '—'}</span>
              <span className="stats__note">distinct recipients</span>
            </div>
            <div className="stats__cell">
              <span className="mono-label">LARGEST RUN</span>
              <span className="stats__value">
                {history ? history.largestRunUnits.toFixed(4) : '—'}
                <span className="stats__unit"> {PONSAJI_TOKEN.payoutAsset.symbol}</span>
              </span>
              <span className="stats__note">single settlement</span>
            </div>
          </div>

          <p className="fold__disclosure">
            {!isLaunched()
              ? 'Nothing has been distributed, because the token is not deployed. These read zero rather than borrowing a number from somewhere else.'
              : history?.incomplete
                ? 'The history could not be read in full from this endpoint, so these figures are shown as unavailable rather than as a partial total.'
                : `Scanned the last ${Math.round((history?.blocksScanned ?? 0) * 0.101 / 3600)} hours of chain. `}
            <Link to="/mechanics" className="fold__link">
              How the split is decided
            </Link>
          </p>
        </section>

      </main>

      <Footer />
    </div>
  )
}
