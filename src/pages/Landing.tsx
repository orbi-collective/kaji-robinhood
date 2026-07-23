import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchOpportunities } from '../lib/adapters'
import ScenePlate from '../components/ScenePlate'
import TopNav from '../components/TopNav'
import IssuePlate from '../components/IssuePlate'
import { SourceTag } from '../components/ui'
import { Sparkline, Bars } from '../components/Sparkline'
import './Landing.css'

const STRESS_TESTS = [
  { name: 'LIQUIDITY −50%', response: 'REDUCE POSITION', tone: 'amber' },
  { name: 'FUNDING REVERSAL', response: 'REQUEST APPROVAL', tone: 'amber' },
  { name: 'ORACLE STALE', response: 'STOP', tone: 'red' },
  { name: 'SLIPPAGE BREACH', response: 'STOP', tone: 'red' },
  { name: 'PROTOCOL PAUSE', response: 'STOP', tone: 'red' },
]

export default function Landing() {
  const { data: opportunities } = useQuery({
    queryKey: ['opportunities'],
    queryFn: ({ signal }) => fetchOpportunities(signal),
  })
  // The rail advertises the single best-ranked recipe, never an aggregate that
  // no user could actually take.
  const best = opportunities?.[0]

  return (
    <div className="landing">
      {/* ---------- Fold 1: full-video foundry hero ---------- */}
      <section className="foundryHero">
        <ScenePlate scene="kaji-foundry" mobileScene="kaji-foundry-mobile" className="foundryHero__plate" />
        <div className="foundryHero__scrim" aria-hidden="true" />

        <TopNav variant="landing" />

        <div className="foundryHero__copy">
          <h1 className="display-h1 foundryHero__h1">
            FORGE THE
            <br />
            CLEANEST CARRY.
            <span className="lime-square" aria-hidden="true" />
          </h1>
          <p className="foundryHero__body">Raw market inputs in. Measured net yield out.</p>
          <div className="foundryHero__ctas">
            <Link to="/opportunities" className="btn-lime foundryHero__cta">
              OPEN THE FOUNDRY <span aria-hidden="true">→</span>
            </Link>
            <Link to="/recipes/carry-alloy" className="btn-outline foundryHero__cta2">
              INSPECT A RECIPE
            </Link>
          </div>

          {/* Token issue plate. Both fields flip to live by passing `value`. */}
          <IssuePlate
            fields={[
              { label: 'CA', value: '0xc97Aab39AbF22cE1d287503f971a5b0edA77DDb0' },
              { label: 'Buy', value: 'Virtuals', href: 'https://app.virtuals.io/virtuals/121080' },
            ]}
          />
        </div>

        <div className="instrumentRail" role="list" aria-label="Live foundry instruments">
          <div className="instrumentRail__cell" role="listitem">
            <span className="mono-label">BEST EST. NET CARRY</span>
            <div className="instrumentRail__row">
              <span className="instrumentRail__value">{best ? `${(best.estimated_net_carry * 100).toFixed(2)}%` : '—'}</span>
              <Sparkline points={best?.trace ?? [3, 4, 3.6, 5, 4.6, 5.4, 5, 6.4, 6, 7.4]} />
            </div>
          </div>
          <div className="instrumentRail__cell" role="listitem">
            <span className="mono-label">ITS RISK SCORE</span>
            <div className="instrumentRail__row">
              <span className="instrumentRail__value">
                {best?.risk_score ?? '—'}
                <span className="instrumentRail__sub"> / 100</span>
              </span>
              <Sparkline points={[3, 3.6, 3.2, 4.4, 4, 5, 4.4, 5.6, 5.2, 6]} />
            </div>
          </div>
          <div className="instrumentRail__cell" role="listitem">
            <span className="mono-label">RECIPES SCANNED</span>
            <div className="instrumentRail__row">
              <span className="instrumentRail__value">{opportunities?.length ?? '—'}</span>
              <Bars values={[2, 3, 2, 4, 3, 5, 4, 3, 5, 4, 6, 5, 4, 6, 5, 7]} />
            </div>
          </div>
          <div className="instrumentRail__cell" role="listitem">
            <span className="mono-label">DATA SOURCE</span>
            <div className="instrumentRail__row">
              <span className="instrumentRail__value instrumentRail__value--source">
                {best ? (best.source === 'live' ? 'LIVE' : 'DEMO') : '—'}
              </span>
              <span className="instrumentRail__pulse" aria-hidden="true" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Fold 2: material ledger ---------- */}
      <section className="fold fold--ledger">
        <h2 className="display-h1 fold__h2">
          EVERY OUTPUT SHOWS ITS INPUTS.
          <span className="lime-square" aria-hidden="true" />
        </h2>
        <p className="fold__intro">
          Kaji prices a strategy the way a foundry prices a casting: every raw input, every cost, on one ledger.
        </p>
        <div className="ledger" role="table" aria-label="Material ledger">
          <div className="ledger__row ledger__row--head" role="row">
            {['ASSET / VENUE', 'GROSS YIELD', 'BORROW COST', 'HEDGE COST', 'LIQUIDITY', 'ORACLE AGE', 'NET ESTIMATE'].map(
              (h) => (
                <span key={h} role="columnheader" className="mono-label">
                  {h}
                </span>
              ),
            )}
          </div>
          {(opportunities ?? []).map((o) => (
            <div key={o.recipe_id} className="ledger__row" role="row">
              <span className="ledger__venue" role="cell">
                {o.inputs.base_asset} / {o.inputs.lending_venue.toUpperCase()}
                {o.inputs.hedge_venue ? ` + ${o.inputs.hedge_venue.toUpperCase()}` : ''}
              </span>
              <span role="cell">{(o.gross_apy * 100).toFixed(2)}%</span>
              <span role="cell" className="ledger__cost">
                {o.breakdown.borrow_cost ? `−${(o.breakdown.borrow_cost * 100).toFixed(2)}%` : '—'}
              </span>
              <span role="cell" className="ledger__cost">
                {o.breakdown.hedge_cost ? `−${(o.breakdown.hedge_cost * 100).toFixed(2)}%` : '—'}
              </span>
              <span role="cell">
                {o.exit_liquidity_usd >= 1e6
                  ? `$${(o.exit_liquidity_usd / 1e6).toFixed(1)}M`
                  : `$${Math.round(o.exit_liquidity_usd / 1000)}K`}
              </span>
              <span role="cell">{o.oracle_age_seconds}s</span>
              <span role="cell" className="ledger__net">
                {(o.estimated_net_carry * 100).toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
        <p className="fold__disclosure">
          Read from the same adapters the scanner uses. Every number is an estimate, not a promise.
        </p>
      </section>

      {/* ---------- Fold 3: assembly line ---------- */}
      <section className="fold fold--line">
        <h2 className="display-h1 fold__h2">
          THE AGENT REASONS. THE POLICY ENGINE DECIDES.
          <span className="lime-square" aria-hidden="true" />
        </h2>
        <div className="assemblyLine" aria-label="Kaji agent pipeline">
          {['SCAN', 'ASSEMBLE', 'SIMULATE', 'VALIDATE', 'PREPARE'].map((step, i) => (
            <div key={step} className="assemblyLine__station">
              <span className="assemblyLine__index mono-label">{String(i + 1).padStart(2, '0')}</span>
              <span className="assemblyLine__name">{step}</span>
              <span className="assemblyLine__desc mono-label">
                {
                  [
                    'RAW PROTOCOL + MARKET INPUTS',
                    'CANDIDATE RECIPES',
                    'NET CARRY / LIQUIDITY / DRAWDOWN',
                    'CAPS · ORACLE · SLIPPAGE · ALLOWLIST',
                    'TX PREVIEW · MANUAL APPROVAL',
                  ][i]
                }
              </span>
            </div>
          ))}
          <div className="assemblyLine__belt" aria-hidden="true" />
        </div>
      </section>

      {/* ---------- Fold 4: strategy recipes ---------- */}
      <section className="fold fold--recipes">
        <h2 className="display-h1 fold__h2">
          STRATEGY RECIPES.
          <span className="lime-square" aria-hidden="true" />
        </h2>
        <div className="recipeSheets">
          {(opportunities ?? []).map((r) => (
            <article key={r.recipe_id} className="recipeSheet">
              <header className="recipeSheet__head">
                <h3 className="recipeSheet__name">{r.name}</h3>
                <SourceTag source={r.source} />
              </header>
              <div className="recipeSheet__carry">
                <span className="mono-label">EST. NET CARRY</span>
                <span className="recipeSheet__carryValue">{(r.estimated_net_carry * 100).toFixed(2)}%</span>
              </div>
              <dl className="recipeSheet__specs">
                <div>
                  <dt className="mono-label">RISK SCORE</dt>
                  <dd>{r.risk_score} / 100</dd>
                </div>
                <div>
                  <dt className="mono-label">EXIT LIQUIDITY</dt>
                  <dd>
                    {r.exit_liquidity_usd >= 1e6
                      ? `$${(r.exit_liquidity_usd / 1e6).toFixed(1)}M`
                      : `$${Math.round(r.exit_liquidity_usd / 1000)}K`}
                  </dd>
                </div>
                <div>
                  <dt className="mono-label">ORACLE AGE</dt>
                  <dd>{r.oracle_age_seconds}s</dd>
                </div>
                <div>
                  <dt className="mono-label">APPROVAL</dt>
                  <dd>MANUAL</dd>
                </div>
              </dl>
              <div className="recipeSheet__mix" aria-label="Ingredient allocation">
                {r.ingredients.map((ing) => (
                  <div key={ing.label} className="recipeSheet__ingredient">
                    <span className="mono-label">{ing.label}</span>
                    <div className="recipeSheet__bar">
                      <div className="recipeSheet__barFill" style={{ width: `${ing.weight}%` }} />
                    </div>
                    <span className="recipeSheet__pct">{ing.weight}%</span>
                  </div>
                ))}
              </div>
              <Link to={`/recipes/${r.recipe_id}`} className="btn-outline recipeSheet__cta">
                RUN SIMULATION <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- Fold 5: risk chamber ---------- */}
      <section className="fold fold--risk">
        <h2 className="display-h1 fold__h2">
          IF THE RECIPE CHANGES, THE MACHINE STOPS.
          <span className="lime-square" aria-hidden="true" />
        </h2>
        <div className="stressGrid">
          {STRESS_TESTS.map((t) => (
            <div key={t.name} className="stressGrid__cell">
              <span className={`dot ${t.tone === 'red' ? 'dot--amber' : 'dot--amber'}`} aria-hidden="true" />
              <span className="stressGrid__name">{t.name}</span>
              <span className={`stressGrid__resp mono-label ${t.tone === 'red' ? 'stressGrid__resp--red' : ''}`}>
                {t.response}
              </span>
            </div>
          ))}
        </div>
        <Link to="/security" className="btn-outline">
          READ THE SECURITY MODEL <span aria-hidden="true">→</span>
        </Link>
      </section>

      {/* ---------- Fold 6: developer interface ---------- */}
      <section className="fold fold--dev">
        <h2 className="display-h1 fold__h2">
          BUILT FOR OPERATORS.
          <span className="lime-square" aria-hidden="true" />
        </h2>
        <div className="devPanel">
          <pre className="devPanel__code">
            <code>{`POST /v1/mandates/simulate
GET  /v1/opportunities
POST /v1/transactions/preview
GET  /v1/agents/:address/health`}</code>
          </pre>
          <pre className="devPanel__code devPanel__code--response">
            <code>{`{
  "recipe_id": "carry-alloy",
  "gross_apy": 0.104,
  "estimated_net_carry": 0.081,
  "risk_score": 34,
  "exit_liquidity_usd": 820000,
  "oracle_age_seconds": 14,
  "status": "REVIEW",
  "disclosures": ["ESTIMATE_ONLY", "NOT_GUARANTEED"]
}`}</code>
          </pre>
        </div>
      </section>

      {/* ---------- Final fold ---------- */}
      <section className="fold fold--final">
        <h2 className="display-h1 fold__h2 fold__h2--big">
          PUT IDLE CAPITAL THROUGH A BETTER PROCESS.
          <span className="lime-square" aria-hidden="true" />
        </h2>
        <Link to="/opportunities" className="btn-lime">
          OPEN THE FOUNDRY <span aria-hidden="true">→</span>
        </Link>
        <p className="fold__disclosure fold__disclosure--final">
          Estimates are informational and do not guarantee returns. Onchain strategies involve loss, liquidity, oracle
          and smart-contract risk.
        </p>
      </section>
    </div>
  )
}
