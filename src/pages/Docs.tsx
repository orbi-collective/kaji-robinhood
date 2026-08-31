import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ScenePlate from '../components/ScenePlate'
import { AppShell } from '../components/AppShell'
import { useWalletGate } from '../components/Wallet'
import { isSybilInvariant, shareOfLateEntry } from '../lib/payroll'
import { explorerAddress } from '../lib/chain'
import { fetchOpportunities } from '../lib/adapters'
import { readPriceFeed } from '../lib/feeds'
import { formatCycleCountdown, isLaunched, projectPayroll, PONSAJI_TOKEN, PREVIEW_WALLET, verifyPayoutAsset } from '../lib/ponsajiToken'
import './Docs.css'

/**
 * How you are paid, and the evidence for it.
 *
 * PONSAJI spends the rest of the app measuring other people's distributions and
 * refusing to repeat their claims. This page holds its own to the same
 * standard: the mechanic is stated, the ledger it runs on is published, the
 * two properties it advertises are computed in front of the reader rather than
 * asserted, and the one trust assumption is named at the top rather than
 * buried under a roadmap.
 */

const usd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function Docs() {
  const { address } = useWalletGate()
  const [lateMinutes, setLateMinutes] = useState(1)

  // The payout asset is asserted onchain rather than trusted from config: this
  // chain carries dozens of tokens with this symbol, and paying every holder in
  // the wrong one would not be recoverable.
  const { data: assetCheck } = useQuery({
    queryKey: ['payout-asset'],
    queryFn: () => verifyPayoutAsset(),
    staleTime: 300_000,
  })

  // The scanner's own readings, used here as evidence rather than as a feature
  // list: the cost of every rival is a measurement this product already makes.
  const { data: venues } = useQuery({
    queryKey: ['opportunities'],
    queryFn: ({ signal }) => fetchOpportunities(signal),
  })

  const rivals = useMemo(() => (venues ?? []).filter((v) => v.distribution), [venues])

  const { data: state, isFetching } = useQuery({
    queryKey: ['payroll'],
    queryFn: async ({ signal }) => {
      if (PONSAJI_TOKEN.previewMode) return projectPayroll(null, signal)
      const eth = await readPriceFeed('ETH_USD').catch(() => null)
      return projectPayroll(eth?.price ?? null, signal)
    },
    enabled: isLaunched(),
    staleTime: 30_000,
    refetchInterval: PONSAJI_TOKEN.previewMode ? 1_000 : false,
  })

  const mine = useMemo(
    () => state?.projected?.records.find((r) => r.wallet.toLowerCase() === (address ?? PREVIEW_WALLET).toLowerCase()) ?? null,
    [state, address],
  )

  /**
   * The lateness bound. Against the live ledger once there is one; before that,
   * against a stated assumption rather than a hidden constant, because a small
   * stand-in field would make this demonstration prove the opposite of the claim.
   */
  const DEMO_SUPPLY_HELD = 333_000_000
  const DEMO_MINUTES_HELD = 60
  const DEMO_BUY = 1_000_000
  const liveService = state?.projected?.totalService ?? null
  const incumbentService = liveService ?? DEMO_SUPPLY_HELD * DEMO_MINUTES_HELD
  const lateShare = shareOfLateEntry({ balance: DEMO_BUY, minutesBefore: lateMinutes, incumbentService })

  return (

    <AppShell>
      <div className="payroll">
        <header className="payroll__head">
          <span className="mono-label">PONSAJI MECHANICS</span>
          <h1 className="display-h1 payroll__h1">
            Paid for time held<span className="lime-period">.</span>
          </h1>
          <p className="payroll__lede">
            The whole arrangement, and the evidence for each part of it: how the account fills, how a claim on it
            accrues, what you are paid in, and the ledger a run divides. Nothing here is asserted that is not also
            computed on this page.
          </p>
        </header>

        {/* ---------- How it works ---------- */}
        <section className="fold" id="how">
          {/* The page title already says what you are paid for; this section
              says why that is a different thing from what everyone else does. */}
          <h2 className="fold__h2">
            A snapshot versus an integral
            <span className="lime-square" aria-hidden="true" />
          </h2>

          <div className="compare">
            <div className="compare__col">
              <span className="mono-label compare__tag">EVERYONE ELSE</span>
              <h3 className="compare__h">A snapshot</h3>
              <p>
                Balances are read at one instant and the pot is split by what everybody held right then. Buy thirty
                seconds before it, collect a full share, sell. The wallets that sat all cycle pay for that.
              </p>
            </div>
            <div className="compare__col compare__col--ours">
              <span className="mono-label compare__tag">HERE</span>
              <h3 className="compare__h">An integral</h3>
              <p>
                Your claim is your balance multiplied by the time you have held it, and reducing your holding restarts
                the clock. Length of service is the multiplier, and it is the one thing that cannot be bought at the
                last moment.
              </p>
              <code className="compare__formula">wᵢ = ∫ bᵢ(t) dt · shareᵢ = wᵢ / Σwⱼ</code>
            </div>
          </div>

          <ol className="steps">
            {[
              ['Trade pays a fee', `Every buy and sell on the launchpad pays a fee, and the creator's share of it is the payroll account. Buys feed it, sells feed it. Trading is the whole economy. There is no treasury and no revenue story.`],
              ['Service accrues', `Every token you hold earns time. Add to your holding and the time already earned stays; reduce it by any amount and those shares restart at zero.`],
              ['The cycle closes', `Cycle length is drawn from the launch instant and the cycle index, the same sequence for everyone, predictable by nobody. The moment is never published, because a published moment is one a late buyer trades around.`],
              ['The account is divided', `The whole account is split by service and sent out. Nothing to claim, no button to press, no deadline to miss.`],
            ].map(([title, body], i) => (
              <li key={title} className="step">
                <span className="step__n mono-label">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3 className="step__h">{title}</h3>
                  <p className="step__p">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Paid in ---------- */}
        <section className="fold fold--asset">
          <ScenePlate scene="kaji-vault" className="fold__plate" />
          <div className="fold__scrim" aria-hidden="true" />
          <h2 className="fold__h2">
            You are paid in {PONSAJI_TOKEN.payoutAsset.symbol}
            <span className="lime-square" aria-hidden="true" />
          </h2>
          <p className="fold__intro">
            The token is paired against {PONSAJI_TOKEN.payoutAsset.symbol} on the launchpad, so fees arrive already
            denominated in it. Payroll never has to swap, which means no slippage and no route to get wrong.
          </p>

          {assetCheck && (
            <div className="assetPanel">
              <div className="assetPanel__head">
                <span className="mono-label">{assetCheck.ok ? 'VERIFIED ONCHAIN' : 'PROBLEM'}</span>
                <a
                  className="assetPanel__addr"
                  href={explorerAddress(PONSAJI_TOKEN.payoutAsset.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {short(PONSAJI_TOKEN.payoutAsset.address)} ↗
                </a>
              </div>
              <p className="assetPanel__line">
                {assetCheck.ok
                  ? `${assetCheck.symbol} confirmed at ${assetCheck.totalSupply?.toLocaleString('en-US', { maximumFractionDigits: 0 })} supply, ${assetCheck.decimals} decimals. Dozens of tokens on this chain share this symbol; the impostors carry a supply of exactly one billion, which this does not.`
                  : assetCheck.problems.join(' ')}
              </p>
              {assetCheck.cautions.map((c) => (
                <p key={c} className="assetPanel__caution">
                  {c}
                </p>
              ))}
            </div>
          )}
        </section>

        {/* ---------- The proofs ---------- */}
        <section className="fold">
          <h2 className="fold__h2">
            Two claims, computed in front of you
            <span className="lime-square" aria-hidden="true" />
          </h2>
          <p className="fold__intro">
            These are statements about other people&apos;s money, so they are calculated here rather than asserted, using
            the same functions that decide what gets paid.
          </p>

          <div className="proofGrid">
            <div className="proofCard">
              <h3 className="proofCard__h">Arriving late cannot be bought off</h3>
              <p>
                A wallet buying <strong>{DEMO_BUY.toLocaleString('en-US')} {PONSAJI_TOKEN.symbol}</strong> this many
                minutes before a run takes at most:
              </p>
              <label className="proofCard__control">
                <span className="mono-label">MINUTES BEFORE THE RUN</span>
                <input
                  type="range"
                  min={0.05}
                  max={30}
                  step={0.05}
                  value={lateMinutes}
                  onChange={(e) => setLateMinutes(Number(e.target.value))}
                />
                <span className="proofCard__readout">{lateMinutes.toFixed(2)} min</span>
              </label>
              <div className="proofCard__result">
                <span className="proofCard__value">{(lateShare * 100).toFixed(3)}%</span>
                <span className="mono-label">OF THE RUN, AT MOST</span>
              </div>
              <code className="proofCard__formula">share ≤ qτ / (qτ + W_rest) → 0 as τ → 0</code>
              <p className="proofCard__note">
                {liveService
                  ? 'Measured against the live ledger.'
                  : `Before launch there is no field to measure against, so this assumes one: ${DEMO_SUPPLY_HELD.toLocaleString('en-US')} ${PONSAJI_TOKEN.symbol} held for ${DEMO_MINUTES_HELD} minutes. It switches to the real ledger the moment there is one.`}
              </p>
            </div>

            <div className="proofCard">
              <h3 className="proofCard__h">Splitting across wallets gains nothing</h3>
              <p>
                Service is linear in balance and in time, so dividing a holding sums straight back. Checked against the
                same function that pays people:
              </p>
              <div className="proofCard__checks">
                {[2, 5, 10, 1000].map((k) => (
                  <span
                    key={k}
                    className={`proofCard__check ${isSybilInvariant(1_000_000, 42, k) ? 'proofCard__check--ok' : 'proofCard__check--fail'}`}
                  >
                    {k} wallets {isSybilInvariant(1_000_000, 42, k) ? '= identical' : '= DIFFERENT'}
                  </span>
                ))}
              </div>
              <code className="proofCard__formula">Σₖ (q/k)·τ = q·τ</code>
              <p className="proofCard__note">
                Ten wallets is one wallet with extra gas. There is no sybil available to run.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- The instrument, as evidence ---------- */}
        <section className="fold fold--instrument">
          <ScenePlate scene="kaji-scanner" className="fold__plate" />
          <div className="fold__scrim" aria-hidden="true" />
          <h2 className="fold__h2">
            We built the thing that measures these
            <span className="lime-square" aria-hidden="true" />
          </h2>
          <p className="fold__intro">
            Before this token existed, PONSAJI was a scanner for exactly this class of position, reading fees from the
            contracts that charge them and asking how long capital must sit before the income repays the round trip.
            Here is what it says about the venues alongside this one, read live.
          </p>

          <div className="rivals">
            <div className="rivals__row rivals__row--head">
              <span className="mono-label">VENUE</span>
              <span className="mono-label">ROUND TRIP</span>
              <span className="mono-label">PAYS HOLDERS</span>
              <span className="mono-label">VERDICT</span>
            </div>
            {rivals.length === 0 && <div className="rivals__empty mono-label">READING THE CHAIN…</div>}
            {rivals.map((v) => (
              <div key={v.recipe_id} className="rivals__row">
                <span className="rivals__name">{v.subtitle}</span>
                <span className="rivals__cost">
                  −{((v.distribution!.entry_fee_bps + v.distribution!.exit_fee_bps) / 100).toFixed(2)}%
                </span>
                <span className="rivals__pays">{v.distribution!.pays_holders ? 'Yes' : 'No, burn to earn'}</span>
                <Link className="rivals__link" to={`/recipes/${v.recipe_id}`}>
                  INSPECT →
                </Link>
              </div>
            ))}
          </div>

          <p className="fold__disclosure">
            The same scanner will price this token once it trades, on the same axis and with the same refusal to
            flatter it.{' '}
            <Link to="/opportunities" className="fold__link">
              Open the scanner
            </Link>{' '}
            ·{' '}
            <Link to="/security" className="fold__link">
              read the security model
            </Link>
          </p>
        </section>

        {/* ---------- Trust ---------- */}
        <section className="fold fold--trust">
          <span className="mono-label trust__eyebrow">WHAT YOU ARE TRUSTING</span>
          <h2 className="trust__h">The account is a wallet, and a wallet has a key</h2>
          <p>
            The money divided here is the launchpad&apos;s creator-fee stream, and it arrives in an ordinary wallet.
            Whoever holds that key can decline to run payroll. No contract compels a distribution, and this page will
            not pretend one does. Every other project in this shape carries the same exposure, and most of them do not
            say so.
          </p>
          <p>
            What is offered instead of a promise: the account address is published, its balance is read live, the
            ledger every run divides is published, and the arithmetic is the same code the tests exercise. You can check
            a run happened and check it was correct. You cannot be assured one will happen.
          </p>
          <p className="trust__foot">
            Money that arrives later pays the people who were already here. That is the shape of every token of this
            kind on this chain, and it belongs on the front page rather than behind a roadmap. Nothing here is a
            promise, nothing here is financial advice, and the account can hold a great deal or nothing at all
            depending entirely on whether anyone trades.
          </p>
        </section>
        {!isLaunched() ? (
          <section className="payroll__pending" id="ledger" role="status">
            <span className="mono-label">PRE-LAUNCH</span>
            <h2 className="payroll__pendingTitle">Not deployed yet</h2>
            <p>
              The token is deployed by hand on the launchpad. Until its address exists there is no ledger, no account
              and nothing to divide, so this page shows the terms and nothing else. It will not display a figure it
              cannot read.
            </p>
            <dl className="payroll__spec">
              <div>
                <dt className="mono-label">MECHANIC</dt>
                <dd>Service integral · paid by time held</dd>
              </div>
              <div>
                <dt className="mono-label">CYCLE</dt>
                <dd>
                  {PONSAJI_TOKEN.cycleMinMinutes}–{PONSAJI_TOKEN.cycleMaxMinutes} minutes, seeded, unpublished
                </dd>
              </div>
              <div>
                <dt className="mono-label">MINIMUM</dt>
                <dd>{PONSAJI_TOKEN.minimumBalance > 0 ? `${PONSAJI_TOKEN.minimumBalance} ${PONSAJI_TOKEN.symbol}` : 'None'}</dd>
              </div>
              <div>
                <dt className="mono-label">ACCOUNT</dt>
                <dd>Launchpad creator fees</dd>
              </div>
              <div>
                <dt className="mono-label">PAID IN</dt>
                <dd>{PONSAJI_TOKEN.payoutAsset.symbol}, paired on the launchpad, never swapped</dd>
              </div>
            </dl>
          </section>
        ) : (
          <section className="payroll__live" id="ledger">
            <div className="payroll__cells">
              <div className="payrollCell">
                <span className="mono-label">IN THE ACCOUNT</span>
                <span className="payrollCell__value payrollCell__value--lime">
                  {state?.account
                    ? `${state.account.units.toFixed(4)} ${PONSAJI_TOKEN.payoutAsset.symbol}`
                    : '—'}
                </span>
                <span className="payrollCell__note">
                  {state?.accountUsd != null ? `${usd(state.accountUsd)} · ` : ''}
                  {PONSAJI_TOKEN.payrollAccount ? (
                    <a href={explorerAddress(PONSAJI_TOKEN.payrollAccount)} target="_blank" rel="noopener noreferrer">
                      {short(PONSAJI_TOKEN.payrollAccount)} ↗
                    </a>
                  ) : (
                    'account not set'
                  )}
                </span>
              </div>
              <div className="payrollCell">
                <span className="mono-label">STAFF ON THE LEDGER</span>
                <span className="payrollCell__value">{state?.projected?.records.length ?? '—'}</span>
                <span className="payrollCell__note">
                  {state ? `${state.ledgerEvents} balance events replayed` : ''}
                </span>
              </div>
              <div className="payrollCell">
                <span className="mono-label">TOTAL SERVICE</span>
                <span className="payrollCell__value">
                  {state?.projected ? state.projected.totalService.toExponential(2) : '—'}
                </span>
                <span className="payrollCell__note">token-minutes, the denominator</span>
              </div>
              <div className="payrollCell">
                <span className="mono-label">CYCLE</span>
                <span className="payrollCell__value">{state?.cycle ? `#${state.cycle.index}` : '—'}</span>
                <span className="payrollCell__note">
                  {/* Never a countdown: a published moment is one a late buyer trades around. */}
                  {PONSAJI_TOKEN.previewMode && state?.cycle
                    ? `${state.cycle.index === 1 ? 'first' : 'next'} distribution in ${formatCycleCountdown(state.cycle.closesAt)}`
                    : 'length is seeded and not published'}
                </span>
              </div>
            </div>

            {state?.blockedBy && (
              <p className="payroll__blocked" role="status">
                {state.blockedBy}
              </p>
            )}

            {mine && (
              <div className="payroll__mine">
                <span className="mono-label">YOUR SERVICE</span>
                <div className="payroll__mineRow">
                  <span>{mine.balance.toLocaleString('en-US')} {PONSAJI_TOKEN.symbol}</span>
                  <span>{mine.minutesHeld.toFixed(1)} min unbroken</span>
                  <span className="payroll__mineShare">{(mine.share * 100).toFixed(3)}% of the next run</span>
                </div>
              </div>
            )}
            {state?.projected && state.projected.records.length > 0 && (
              <div className="ledger">
                <div className="ledger__row ledger__row--head">
                  <span className="mono-label">WALLET</span>
                  <span className="mono-label">BALANCE</span>
                  <span className="mono-label">UNBROKEN</span>
                  <span className="mono-label">SERVICE</span>
                  <span className="mono-label">SHARE</span>
                </div>
                {state.projected.records.slice(0, 12).map((r) => (
                  <div key={r.wallet} className="ledger__row">
                    <span className="ledger__wallet">{short(r.wallet)}</span>
                    <span>{r.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                    <span>{r.minutesHeld.toFixed(1)}m</span>
                    <span>{r.service.toExponential(2)}</span>
                    <span className="ledger__share">{(r.share * 100).toFixed(3)}%</span>
                  </div>
                ))}
                <p className="ledger__note">
                  Replayed from the token&apos;s own Transfer logs {isFetching ? '· reading…' : ''}. Anyone with the
                  same logs computes the same table.
                </p>
              </div>
            )}
          </section>
        )}

        <p className="payroll__foot">
          Nothing on this page is a promise. The account holds whatever trading has put in it, which may be a great deal
          or nothing at all. Money that arrives later pays the people who were already here. That is the shape of every
          token of this kind on this chain, and it belongs on the front of the page rather than behind a roadmap.
        </p>
      </div>
    </AppShell>
  )
}
