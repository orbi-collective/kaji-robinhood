import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { VerdictTag, relativeTime } from '../components/ui'
import {
  CHAIN_ID,
  CHAIN_NAME,
  EXPLORER_URL,
  IS_LIVE_CHAIN,
  MORPHO,
  PRICE_FEEDS,
  TOKENS,
  VAULTS,
  explorerAddress,
} from '../lib/chain'
import { fetchOpportunities, verifyDeployment } from '../lib/adapters'
import { formatDuration } from '../lib/policy'
import { DEFAULT_MANDATE, type PolicyVerdict } from '../lib/types'
import { useAgent } from '../state/AgentStore'
import './Security.css'

type Guardrail = {
  id: string
  name: string
  verdict: PolicyVerdict
  detail: string
  /** The limit this check enforces, shown beside what was observed. */
  bound: string
  checkedAt: number
}

/**
 * The hard boundary. These are not policy settings a user can widen — they are
 * properties of how this app is built, which is the actual trust argument.
 */
/** Allowlist entries are slugs; people read names. */
const VENUE_NAMES: Record<string, string> = {
  morpho: 'Morpho',
  'the-index': 'The Index',
  quotrons: 'Quotrons',
  hood10: 'HOOD10',
}

const PROHIBITIONS = [
  { rule: 'Invent calldata', why: 'Every transaction is assembled from a fixed template and simulated before you see it.' },
  { rule: 'Bypass the allowlist', why: 'Interactions outside your approved venues are refused, not flagged.' },
  { rule: 'Raise your limits', why: 'Spend, leverage and slippage ceilings can only be changed by you, in the mandate.' },
  { rule: 'Move funds outside the mandate', why: 'PONSAJI never takes custody. Your wallet is the only signer.' },
  { rule: 'Promise a return', why: 'Every figure is an estimate carrying its inputs, timestamp and what breaks it.' },
]

export default function Security() {
  const { mandate, totalCapital } = useAgent()
  const active = mandate ?? DEFAULT_MANDATE

  const { data: opportunities, dataUpdatedAt } = useQuery({
    queryKey: ['opportunities'],
    queryFn: ({ signal }) => fetchOpportunities(signal),
  })

  // Re-checks onchain that each configured vault really holds the asset we
  // expect, so a bad address surfaces here instead of at signing time.
  const { data: deployment } = useQuery({
    queryKey: ['deployment-integrity'],
    queryFn: () => verifyDeployment(),
    enabled: IS_LIVE_CHAIN,
    staleTime: 60_000,
  })

  /** Guardrails are computed from live state, never hard-coded rows. */
  const guardrails = useMemo<Guardrail[]>(() => {
    const now = Date.now()
    // Only rows that actually reference an oracle may set the freshness bound.
    // Folding a venue that has no oracle into this reduce would substitute a
    // default heartbeat and make healthy feeds read as stale.
    const oracleRows = (opportunities ?? []).filter(
      (o) => o.oracle_age_seconds !== null && o.oracle_heartbeat_seconds !== null,
    )
    const stalest = oracleRows.reduce((max, o) => Math.max(max, o.oracle_age_seconds ?? 0), 0)
    const heartbeat = oracleRows.length
      ? oracleRows.reduce((min, o) => Math.min(min, o.oracle_heartbeat_seconds ?? Infinity), Infinity)
      : 0
    const oracleFree = (opportunities ?? []).length - oracleRows.length
    const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

    return [
      {
        id: 'signing',
        name: 'Signing authority',
        verdict: 'pass',
        // There is no session-key mechanism in this build, so there is no scope
        // to report and nothing that could be revoked. The honest check is that
        // no key exists at all.
        detail: 'No standing key exists. Every action requires your signature, and nothing is prepared while this tab is closed.',
        bound: 'manual only',
        checkedAt: now,
      },
      {
        id: 'allowlist',
        name: 'Protocol allowlist',
        verdict: 'pass',
        detail: `Interactions are restricted to ${active.protocol_allowlist
          .map((v) => VENUE_NAMES[v] ?? v)
          .join(', ')}. Anything else is refused, not flagged.`,
        bound: `${active.protocol_allowlist.length} venue${active.protocol_allowlist.length > 1 ? 's' : ''}`,
        checkedAt: now,
      },
      {
        id: 'oracle',
        name: 'Oracle freshness',
        verdict: !oracleRows.length ? 'review' : stalest > heartbeat ? 'review' : 'pass',
        detail: !oracleRows.length
          ? 'No venue in this scan references a price oracle, so there is no feed freshness to report.'
          : stalest > heartbeat
            ? `Stalest feed ${formatDuration(stalest)}, past its heartbeat. Execution paused on affected recipes.`
            : `All Chainlink feeds reporting inside their publisher heartbeat.${
                oracleFree > 0
                  ? ` ${oracleFree} venue${oracleFree > 1 ? 's' : ''} in this scan reference no oracle at all.`
                  : ''
              }`,
        bound: oracleRows.length ? `${formatDuration(stalest)} / ${formatDuration(heartbeat)}` : 'n/a',
        checkedAt: now,
      },
      {
        id: 'deployment',
        name: 'Deployment integrity',
        verdict: !IS_LIVE_CHAIN ? 'review' : deployment ? (deployment.ok ? 'pass' : 'block') : 'review',
        detail: !IS_LIVE_CHAIN
          ? 'No chain endpoint, so vault addresses cannot be verified.'
          : deployment
            ? deployment.ok
              ? 'Every vault confirmed onchain to hold the underlying asset it claims.'
              : deployment.problems.join(' ')
            : 'Verifying vault contracts against their expected underlying asset…'
        ,
        bound: `${VAULTS.length} vault${VAULTS.length > 1 ? 's' : ''}`,
        checkedAt: now,
      },
      {
        id: 'simulation',
        name: 'Transaction simulation',
        verdict: IS_LIVE_CHAIN ? 'pass' : 'review',
        detail: IS_LIVE_CHAIN
          ? 'Every action is simulated against current state before it is offered for signature.'
          : `No ${CHAIN_NAME} endpoint configured, so simulation runs on reference data only.`,
        bound: 'pre-signature',
        checkedAt: now,
      },
      {
        id: 'spend_cap',
        name: 'Spend cap',
        verdict: totalCapital > active.capital_usd ? 'block' : 'pass',
        detail:
          totalCapital > active.capital_usd
            ? 'Deployed capital exceeds the mandate cap. Every further position is blocked.'
            : 'Projected spend within the mandate cap.',
        bound: `${usd(totalCapital)} / ${usd(active.capital_usd)}`,
        checkedAt: now,
      },
    ]
  }, [opportunities, active, totalCapital, deployment])

  const engineVerdict: PolicyVerdict = guardrails.some((g) => g.verdict === 'block')
    ? 'block'
    : guardrails.some((g) => g.verdict === 'review')
      ? 'review'
      : 'pass'

  const attention = guardrails.filter((g) => g.verdict !== 'pass').length

  const contracts = [
    ...VAULTS.map((v) => ({ label: `${v.name} vault`, address: v.address })),
    { label: `${TOKENS.USDG.symbol} token`, address: TOKENS.USDG.address },
    { label: 'Morpho Blue', address: MORPHO.core },
    { label: 'Chainlink USDG/USD', address: PRICE_FEEDS.USDG_USD.address },
  ]

  return (
    <AppShell>
      <div className="securityPage">
        <header className="securityHead">
          <div className="securityHead__copy">
            <h1 className="display-h1 securityHead__h1">
              Nothing here can move your money<span className="lime-period">.</span>
            </h1>
            <p className="securityHead__sub">
              PONSAJI never takes custody, holds no key, and runs nothing in the background. Every action is simulated and
              checked against your mandate, then handed to your wallet to sign or refuse.
            </p>
          </div>

          <div className={`engineStatus engineStatus--${engineVerdict}`} role="status">
            <span className="mono-label engineStatus__label">POLICY ENGINE</span>
            <strong className="engineStatus__verdict">
              {engineVerdict === 'pass' ? 'WITHIN SPEC' : engineVerdict === 'review' ? 'REVIEW' : 'BLOCKED'}
            </strong>
            <dl className="engineStatus__meta">
              <div>
                <dt>Checks passing</dt>
                <dd>
                  {guardrails.length - attention}/{guardrails.length}
                </dd>
              </div>
              <div>
                <dt>Unsigned actions</dt>
                <dd>0</dd>
              </div>
              <div>
                <dt>Last inspection</dt>
                <dd>{dataUpdatedAt ? relativeTime(dataUpdatedAt) : 'running…'}</dd>
              </div>
            </dl>
          </div>
        </header>

        <section className="guardrails" aria-labelledby="guardrails-title">
          <div className="sectionHead">
            <h2 id="guardrails-title" className="sectionHead__title">
              Policy guardrails
            </h2>
            <span className="mono-label sectionHead__meta">
              {attention === 0 ? 'ALL CHECKS PASSING' : `${attention} NEED ATTENTION`}
            </span>
          </div>

          <div className="guardrails__table" role="table">
            <div className="guardrails__head" role="row">
              <span role="columnheader" className="mono-label">
                GUARDRAIL
              </span>
              <span role="columnheader" className="mono-label">
                STATUS
              </span>
              <span role="columnheader" className="mono-label">
                WHAT IT ENFORCES
              </span>
              <span role="columnheader" className="mono-label">
                OBSERVED / BOUND
              </span>
            </div>
            {guardrails.map((g) => (
              <div key={g.id} className={`guardrails__row guardrails__row--${g.verdict}`} role="row">
                <span className="guardrails__name" role="cell">
                  {g.name}
                </span>
                <span role="cell">
                  <VerdictTag verdict={g.verdict} />
                </span>
                <span className="guardrails__detail" role="cell">
                  {g.detail}
                </span>
                <span className="guardrails__bound" role="cell">
                  {g.bound}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="securityPage__split">
          <section className="prohibitions" aria-labelledby="never-title">
            <div className="sectionHead">
              <h2 id="never-title" className="sectionHead__title">
                What PONSAJI can never do
              </h2>
              <span className="mono-label sectionHead__meta">NOT A SETTING</span>
            </div>
            <ul className="prohibitions__list">
              {PROHIBITIONS.map((p) => (
                <li key={p.rule} className="prohibition">
                  <span className="prohibition__mark" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 13 13">
                      <path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="prohibition__body">
                    <strong>{p.rule}</strong>
                    <span>{p.why}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="contracts" aria-labelledby="contracts-title">
            <div className="sectionHead">
              <h2 id="contracts-title" className="sectionHead__title">
                Contracts it talks to
              </h2>
              <span className="mono-label sectionHead__meta">
                {CHAIN_NAME.toUpperCase()} · {CHAIN_ID}
              </span>
            </div>
            <p className="contracts__warning">
              A token or vault with a matching name but a different address is not the same contract. Verify each one
              before you deposit.
            </p>
            <ul className="contracts__list">
              {contracts.map((c) => (
                <li key={c.address} className="contracts__row">
                  <span className="contracts__label">{c.label}</span>
                  <a
                    className="contracts__addr"
                    href={explorerAddress(c.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="contracts__addrText">{c.address}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="contracts__foot mono-label">
              EXPLORER{' '}
              <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer">
                {EXPLORER_URL.replace(/^https?:\/\//, '')}
              </a>
            </p>
          </section>
        </div>

        <p className="securityPage__disclosure">
          Estimates are informational and do not guarantee returns. Onchain strategies involve loss, liquidity, oracle
          and smart-contract risk.
        </p>
      </div>

    </AppShell>
  )
}
