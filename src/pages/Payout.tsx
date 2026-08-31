import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useWalletGate } from '../components/Wallet'
import { explorerAddress } from '../lib/chain'
import { readPriceFeed } from '../lib/feeds'
import {
  PONSAJI_TOKEN,
  formatCycleCountdown,
  isLaunched,
  projectPayroll,
  readDistributionHistory,
  readWalletLedger,
  PREVIEW_WALLET,
  type BalancePoint,
} from '../lib/ponsajiToken'
import './Payout.css'

/**
 * What one wallet is owed, and why.
 *
 * The page exists to make a single claim checkable: your share is your service
 * over everyone's service, and service is balance multiplied by the time you
 * held it. So the centre of the page is the curve that produces the number,
 * not the number on its own.
 *
 * Nothing here is projected forward. The account balance is what the account
 * holds now, the service is what has accrued up to the last block read, and the
 * share is what those two produce if the run landed at that moment. The run's
 * actual moment is seeded and never published, because a published moment is
 * one a late buyer trades around.
 */

const UNITS = 4

const fmt = (n: number, digits = UNITS) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Token-minutes get large fast, so they are abbreviated rather than wrapped. */
function serviceLabel(tokenMinutes: number): string {
  const abs = Math.abs(tokenMinutes)
  if (abs >= 1e9) return `${(tokenMinutes / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(tokenMinutes / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(tokenMinutes / 1e3).toFixed(2)}K`
  return tokenMinutes.toFixed(2)
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(Math.round(n))
}

const utc = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

const utcDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' })

/* ------------------------------------------------------------------ */
/* The curve                                                           */
/* ------------------------------------------------------------------ */

/**
 * A worked example, drawn only when there is no real series to draw.
 *
 * It is labelled as an example wherever it appears. The alternative is an empty
 * frame, which teaches nothing about the one mechanic this whole product turns
 * on: that a reduction forfeits everything accrued and restarts the clock.
 */
const EXAMPLE: BalancePoint[] = (() => {
  const t0 = Date.UTC(2026, 0, 1, 13, 4)
  const min = 60_000
  const steps: Array<[number, number]> = [
    [8, 500_000],
    [16, 750_000],
    [30, 400_000],
    [46, 800_000],
    [58, -1_150_000],
    [60, 300_000],
  ]
  let balance = 0
  return steps.map(([m, change]) => {
    balance += change
    return { at: t0 + m * min, balance, change }
  })
})()

/** Axis steps a person reads without decoding: 1, 2, 2.5 or 5 times a power of ten. */
function niceScale(peak: number, target = 5): { top: number; step: number } {
  const rough = peak / target
  const magnitude = 10 ** Math.floor(Math.log10(rough || 1))
  const normalised = rough / magnitude
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10) * magnitude
  return { top: Math.ceil(peak / step) * step, step }
}

function Curve({ points, readAt, example }: { points: BalancePoint[]; readAt: number; example: boolean }) {
  const W = 1000
  const H = 320
  const PAD = { top: 46, right: 22, bottom: 52, left: 84 }

  const geometry = useMemo(() => {
    if (points.length === 0) return null
    const t0 = points[0].at
    const t1 = Math.max(readAt, points[points.length - 1].at)
    const spanMs = Math.max(1, t1 - t0)
    const peak = Math.max(...points.map((p) => p.balance), 1)
    const { top, step } = niceScale(peak)

    const x = (at: number) => PAD.left + ((at - t0) / spanMs) * (W - PAD.left - PAD.right)
    const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom)

    // A balance is a step function, not a slope: it holds until a transfer
    // changes it. Drawing it as a line would imply the balance drifted.
    const path: string[] = [`M ${x(t0)} ${y(0)}`]
    let previous = 0
    for (const p of points) {
      path.push(`L ${x(p.at)} ${y(previous)}`, `L ${x(p.at)} ${y(p.balance)}`)
      previous = p.balance
    }
    path.push(`L ${x(t1)} ${y(previous)}`)
    const line = path.join(' ')

    const ticks: number[] = []
    for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v)

    const times = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + spanMs * f)

    // Each label sits just above the step it belongs to, so a reader never has
    // to trace a long leader back to find which increase it names.
    const buys = points
      .filter((p) => p.change > 0)
      .map((p) => ({ ...p, labelY: Math.max(PAD.top - 8, y(p.balance) - 20) }))

    return {
      x,
      y,
      line,
      area: `${line} L ${x(t1)} ${y(0)} Z`,
      ticks,
      times,
      buys,
      reduction: points.find((p) => p.change < 0) ?? null,
      baseline: y(0),
    }
  }, [points, readAt, PAD.left, PAD.right, PAD.top, PAD.bottom])

  if (!geometry) return null

  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Balance over time">
      <defs>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--signal-lime)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--signal-lime)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      <text
        className="curve__axisTitle"
        transform={`translate(16 ${(PAD.top + geometry.baseline) / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {PONSAJI_TOKEN.symbol} BALANCE
      </text>

      {geometry.ticks.map((v) => (
        <g key={v}>
          <line className="curve__grid" x1={PAD.left} y1={geometry.y(v)} x2={W - PAD.right} y2={geometry.y(v)} />
          <text className="curve__axis" x={PAD.left - 12} y={geometry.y(v) + 4} textAnchor="end">
            {compact(v)}
          </text>
        </g>
      ))}

      <path className="curve__area" d={geometry.area} fill="url(#curveFill)" />
      <path className="curve__line" d={geometry.line} />

      {geometry.buys.map((p) => (
        <g key={`buy-${p.at}`}>
          <line
            className="curve__leader"
            x1={geometry.x(p.at)}
            y1={geometry.y(p.balance)}
            x2={geometry.x(p.at)}
            y2={p.labelY + 5}
          />
          <text className="curve__buy" x={geometry.x(p.at)} y={p.labelY} textAnchor="middle">
            +{compact(p.change)}
          </text>
        </g>
      ))}

      {geometry.reduction && (
        <g>
          <line
            className="curve__reset"
            x1={geometry.x(geometry.reduction.at)}
            y1={PAD.top - 22}
            x2={geometry.x(geometry.reduction.at)}
            y2={geometry.baseline}
          />
          <circle
            className="curve__resetDot"
            cx={geometry.x(geometry.reduction.at)}
            cy={geometry.y(geometry.reduction.balance)}
            r="4"
          />
          <text
            className="curve__resetLabel"
            x={Math.min(geometry.x(geometry.reduction.at) + 8, W - PAD.right)}
            y={PAD.top - 26}
            textAnchor="end"
          >
            REDUCTION RESTARTS SERVICE
          </text>
        </g>
      )}

      {geometry.times.map((at) => (
        <text key={at} className="curve__axis" x={geometry.x(at)} y={geometry.baseline + 20} textAnchor="middle">
          {utc(at)}
        </text>
      ))}

      <text className="curve__axisTitle" x={(PAD.left + W - PAD.right) / 2} y={H - 8} textAnchor="middle">
        TIME (UTC)
      </text>

      {example && (
        <text className="curve__example" x={W - PAD.right} y={geometry.baseline - 10} textAnchor="end">
          EXAMPLE, NOT YOUR DATA
        </text>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ */

export default function Payout() {
  const { address, isConnected } = useWalletGate()
  const launched = isLaunched()
  const viewer = address ?? PREVIEW_WALLET
  const viewerActive = isConnected || PONSAJI_TOKEN.previewMode

  const { data: state } = useQuery({
    queryKey: ['payroll'],
    queryFn: async ({ signal }) => {
      if (PONSAJI_TOKEN.previewMode) return projectPayroll(null, signal)
      const eth = await readPriceFeed('ETH_USD').catch(() => null)
      return projectPayroll(eth?.price ?? null, signal)
    },
    enabled: launched,
    staleTime: 30_000,
    refetchInterval: PONSAJI_TOKEN.previewMode ? 1_000 : false,
  })

  const { data: history } = useQuery({
    queryKey: ['distribution-history', viewer],
    queryFn: ({ signal }) => readDistributionHistory(72, signal, viewer),
    staleTime: 60_000,
    refetchInterval: PONSAJI_TOKEN.previewMode ? 1_000 : false,
  })

  const { data: ledger, isPending: ledgerPending } = useQuery({
    queryKey: ['wallet-ledger', viewer],
    queryFn: ({ signal }) => readWalletLedger(viewer, signal),
    enabled: viewerActive && launched,
    staleTime: 30_000,
    refetchInterval: PONSAJI_TOKEN.previewMode ? 1_000 : false,
  })

  const totalService = state?.projected?.totalService ?? 0
  const share = ledger && totalService > 0 ? ledger.service / totalService : null
  const hasCurve = Boolean(ledger && ledger.points.length > 0)
  const points = hasCurve ? ledger!.points : EXAMPLE
  const readAt = hasCurve ? ledger!.readAt : EXAMPLE[EXAMPLE.length - 1].at + 20 * 60_000

  const account = state?.account ?? null
  const runs = history?.recent ?? []

  // No scene plate here. This is an instrument panel: a video behind live
  // figures competes with the one thing the page exists to show.
  return (
    <AppShell>
      <div className="payoutPage">
        {/*
          The cycle index, and never its close time.

          A published moment is one a late buyer can trade around, which is
          exactly the behaviour the service integral exists to make worthless.
          The index says which run you are accruing into; that is all a holder
          needs and all anyone should get.
        */}
        <div className="cycleStrip">
          <span className={`cycleStrip__dot ${state?.cycle ? 'cycleStrip__dot--open' : ''}`} aria-hidden="true" />
          <span className="mono-label">
            {state?.cycle ? `CYCLE #${state.cycle.index} · OPEN` : 'NO CYCLE · PRE-LAUNCH'}
          </span>
          <span className="cycleStrip__note">
            {state?.cycle
              ? PONSAJI_TOKEN.previewMode
                ? `${state.cycle.index === 1 ? 'First' : 'Next'} distribution in ${formatCycleCountdown(state.cycle.closesAt)}.`
                : 'The closing moment is seeded and never published.'
              : 'Cycles begin at the launch instant, read from the pool itself.'}
          </span>
        </div>

        {/* ---------- the two figures ---------- */}
        <div className="payoutHead">
          <section className="payoutHead__cell">
            <span className="mono-label payoutHead__key">YOUR SERVICE</span>
            {!launched ? (
              <>
                <span className="payoutHead__value payoutHead__value--muted">NOT DEPLOYED</span>
                <span className="payoutHead__sub">There is no ledger to accrue against yet.</span>
              </>
            ) : !viewerActive ? (
              <>
                <span className="payoutHead__value payoutHead__value--muted">NO WALLET</span>
                <span className="payoutHead__sub">Connect a wallet to read its service from the chain.</span>
              </>
            ) : ledgerPending ? (
              <>
                <span className="payoutHead__value payoutHead__value--muted">READING…</span>
                <span className="payoutHead__sub">Replaying this wallet&rsquo;s transfers.</span>
              </>
            ) : !ledger || ledger.incomplete ? (
              <>
                <span className="payoutHead__value payoutHead__value--muted">NOT REPORTED</span>
                <span className="payoutHead__sub">
                  The ledger could not be read in full, so no figure is shown rather than a partial one.
                </span>
              </>
            ) : (
              <>
                <span className="payoutHead__value">
                  {serviceLabel(ledger.service)} <span className="payoutHead__unit">TOKEN-MIN</span>
                </span>
                <span className="payoutHead__sub">
                  {share === null
                    ? 'No wallet has accrued service yet, so there is no share to state.'
                    : `${(share * 100).toFixed(3)}% of the next run at this instant`}
                </span>
              </>
            )}
          </section>

          <section className="payoutHead__cell">
            <span className="mono-label payoutHead__key">PUBLIC PAYROLL ACCOUNT</span>
            {account ? (
              <>
                <span className="payoutHead__value">
                  {fmt(account.units)} <span className="payoutHead__unit">{PONSAJI_TOKEN.payoutAsset.symbol}</span>
                </span>
                <span className="payoutHead__sub">
                  {account.usd !== null
                    ? `$${account.usd.toLocaleString('en-US', { maximumFractionDigits: 2 })} to divide`
                    : 'Balance read; no price available, so no dollar figure is shown.'}
                  {PONSAJI_TOKEN.payrollAccount && (
                    <>
                      {' '}
                      <a
                        className="payoutHead__link"
                        href={explorerAddress(PONSAJI_TOKEN.payrollAccount)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        watch it <span aria-hidden="true">↗</span>
                      </a>
                    </>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="payoutHead__value payoutHead__value--muted">
                  0 <span className="payoutHead__unit">{PONSAJI_TOKEN.payoutAsset.symbol}</span>
                </span>
                <span className="payoutHead__sub">
                  No account exists yet. This reads zero rather than borrowing a number from somewhere else.
                </span>
              </>
            )}
          </section>
        </div>

        {/* ---------- the curve ---------- */}
        <section className="payoutChart">
          <div className="payoutChart__head">
            <h1 className="payoutChart__title">
              BALANCE <span className="payoutChart__times">×</span> TIME
            </h1>
            {!hasCurve && (
              <span className="payoutChart__flag mono-label">
                {launched && viewerActive ? 'NO TRANSFERS FOR THIS WALLET' : 'WORKED EXAMPLE'}
              </span>
            )}
          </div>

          {/* Scrolls rather than shrinks. Squeezed into a phone the axis labels
              render around three pixels tall, which is a chart you cannot read;
              a swipe keeps every label at its intended size. */}
          <div className="payoutChart__plot">
            <Curve points={points} readAt={readAt} example={!hasCurve} />
          </div>

          <p className="payoutChart__legend">
            <span className="payoutChart__swatch" aria-hidden="true" />
            Every increase adds to the area under the line, which is your service. A reduction of any size forfeits the
            area accrued so far and restarts the clock from that moment.
            {!hasCurve && (
              <strong className="payoutChart__disclaimer">
                {' '}
                The curve above is a worked example. It is replaced by your own transfers the moment there are any.
              </strong>
            )}
          </p>
        </section>

        {/* ---------- the three readings ---------- */}
        <div className="payoutFacts">
          <div className="payoutFacts__cell">
            <span className="mono-label">BALANCE</span>
            <span className="payoutFacts__value">
              {hasCurve ? ledger!.balance.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}{' '}
              <span className="payoutFacts__unit">{PONSAJI_TOKEN.symbol}</span>
            </span>
          </div>
          <div className="payoutFacts__cell">
            <span className="mono-label">HELD</span>
            <span className="payoutFacts__value">
              {hasCurve ? Math.floor(ledger!.minutesHeld).toLocaleString('en-US') : '—'}{' '}
              <span className="payoutFacts__unit">MIN</span>
            </span>
          </div>
          <div className="payoutFacts__cell">
            <span className="mono-label">SERVICE START</span>
            <span className="payoutFacts__value">
              {hasCurve && ledger!.serviceStart !== null ? utc(ledger!.serviceStart) : '—'}{' '}
              <span className="payoutFacts__unit">UTC</span>
            </span>
          </div>
        </div>

        {/* ---------- the arithmetic, and the record ---------- */}
        <div className="payoutSplit">
          <section className="shareBox">
            <h2 className="shareBox__h">HOW YOUR SHARE IS FORMED</h2>
            <div className="shareBox__body">
              <div className="shareBox__formula">
                <span>YOUR SERVICE</span>
                <span className="shareBox__divide" aria-hidden="true">
                  ÷
                </span>
                <span>TOTAL SERVICE</span>
              </div>
              <p className="shareBox__note">
                Service is the balance you maintain over time. More balance, held longer, means more service. Nothing
                about when you arrive matters except how long ago it was.
              </p>
            </div>
            <p className="shareBox__foot mono-label">PAID FOR TIME ACTUALLY HELD.</p>
          </section>

          <section className="runsBox">
            <h2 className="runsBox__h">RECENT DISTRIBUTIONS</h2>
            {runs.length === 0 ? (
              <p className="runsBox__empty">
                {history?.incomplete
                  ? 'The record could not be read in full from this endpoint, so nothing is listed rather than a partial history.'
                  : 'Nothing has been distributed yet. This table fills itself from the payout asset’s own Transfer logs, so anyone with the same logs sees the same rows.'}
              </p>
            ) : (
              <div className="runsTable" role="table" aria-label="Recent distributions">
                <div className="runsTable__head" role="row">
                  <span role="columnheader">DATE</span>
                  <span role="columnheader">DISTRIBUTED</span>
                  <span role="columnheader">WALLETS</span>
                  <span role="columnheader">YOUR SHARE</span>
                  <span role="columnheader">YOU RECEIVED</span>
                </div>
                {runs.slice(0, 6).map((run) => (
                  <div className="runsTable__row" role="row" key={run.at}>
                    <span role="cell">{utcDate(run.at)}</span>
                    <span role="cell">{fmt(run.units, 2)}</span>
                    <span role="cell">{run.recipients.toLocaleString('en-US')}</span>
                    <span role="cell">{run.viewerShare === null ? '—' : `${(run.viewerShare * 100).toFixed(3)}%`}</span>
                    <span role="cell" className="runsTable__mine">
                      {run.viewerUnits === null ? '—' : fmt(run.viewerUnits)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {runs.length > 0 && !viewerActive && (
              <p className="runsBox__hint">Connect a wallet to see what it received in each run.</p>
            )}
          </section>
        </div>

        <p className="payoutPage__foot">
          Figures are read from the chain at the block shown, not projected forward. The run&rsquo;s exact moment is
          seeded and never published, because a published moment is one a late buyer can trade around.{' '}
          <Link to="/docs#how" className="payoutPage__link">
            How the split is decided
          </Link>
        </p>
      </div>
    </AppShell>
  )
}
