import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { DEFAULT_MANDATE, type AgentEvent, type Mandate, type Position } from '../lib/types'

/**
 * Local state: the mandate, deployed positions and the event log.
 *
 * Persisted to localStorage so a reload never loses a user's mandate — this is
 * the one thing they spent real thought on.
 *
 * There is deliberately no paused or stopped state here. Nothing runs when the
 * tab is closed and this app never holds a key, so a flag claiming to have
 * halted something would be describing a machine that does not exist.
 */

type State = {
  mandate: Mandate | null
  positions: Position[]
  events: AgentEvent[]
  hydrated: boolean
}

type Action =
  | { type: 'hydrate'; state: Partial<State> }
  | { type: 'setMandate'; mandate: Mandate }
  | { type: 'clearMandate' }
  | { type: 'addPosition'; position: Position }
  | { type: 'closePosition'; id: string }
  | { type: 'resolveEvent'; id: string; outcome: 'executed' | 'skipped' }
  | { type: 'addEvent'; event: AgentEvent }

const STORAGE_KEY = 'ponsaji.agent.v1'
/** Every name this app has shipped under, newest first. A rebrand must not
    silently discard a mandate somebody sat and thought about. */
const LEGACY_STORAGE_KEYS = ['ponsaji.agent.v1', 'kaji.agent.v1']

/**
 * Brings a stored mandate up to the current shape.
 *
 * A mandate is the one thing a user spent real thought on, so an older one is
 * migrated rather than discarded. Fields that did not exist when it was written
 * take the current defaults, and the single `base_asset` becomes the set it
 * always meant.
 */
function migrateMandate(raw: unknown): Mandate | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<Mandate> & { base_asset?: string }

  const base_assets =
    Array.isArray(m.base_assets) && m.base_assets.length > 0
      ? m.base_assets
      : m.base_asset
        ? [m.base_asset]
        : DEFAULT_MANDATE.base_assets

  return {
    ...DEFAULT_MANDATE,
    ...m,
    base_assets,
    max_round_trip_bps: m.max_round_trip_bps ?? DEFAULT_MANDATE.max_round_trip_bps,
    max_breakeven_days: m.max_breakeven_days ?? DEFAULT_MANDATE.max_breakeven_days,
    protocol_allowlist:
      Array.isArray(m.protocol_allowlist) && m.protocol_allowlist.length > 0
        ? // Older mandates predate the distribution venues; authorising only
          // what they listed would silently block every new row.
          [...new Set([...m.protocol_allowlist, ...DEFAULT_MANDATE.protocol_allowlist])]
        : DEFAULT_MANDATE.protocol_allowlist,
  }
}

const initialState: State = {
  mandate: null,
  positions: [],
  events: [],
  hydrated: false,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return { ...state, ...action.state, hydrated: true }
    case 'setMandate':
      return {
        ...state,
        mandate: action.mandate,
        events: [event('executed', 'Mandate updated', 'Limits applied. Every row is re-checked against them on the next read.'), ...state.events],
      }
    case 'clearMandate':
      return { ...state, mandate: null }
    case 'addPosition':
      return {
        ...state,
        positions: [action.position, ...state.positions],
        events: [
          event(
            'executed',
            'Position opened',
            `${action.position.recipe_name} funded with $${action.position.capital_usd.toLocaleString('en-US')}.`,
          ),
          ...state.events,
        ],
      }
    case 'closePosition':
      return {
        ...state,
        positions: state.positions.map((p) => (p.id === action.id ? { ...p, status: 'closed' } : p)),
        events: [event('executed', 'Position closed', 'Capital returned to the connected wallet.'), ...state.events],
      }
    case 'resolveEvent':
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.id ? { ...e, kind: action.outcome, recommendation: undefined } : e,
        ),
      }
    case 'addEvent':
      return { ...state, events: [action.event, ...state.events].slice(0, 40) }
    default:
      return state
  }
}

let seq = 0
function event(kind: AgentEvent['kind'], title: string, detail: string): AgentEvent {
  return { id: `${Date.now()}-${seq++}`, kind, title, detail, at: Date.now() }
}

type Store = State & {
  setMandate: (m: Mandate) => void
  addPosition: (p: Position) => void
  closePosition: (id: string) => void
  resolveEvent: (id: string, outcome: 'executed' | 'skipped') => void
  totalCapital: number
  blendedCarry: number
}

const AgentContext = createContext<Store | null>(null)

export function AgentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    try {
      const raw = LEGACY_STORAGE_KEYS.reduce<string | null>((found, key) => found ?? localStorage.getItem(key), localStorage.getItem(STORAGE_KEY))
      const parsed = raw ? (JSON.parse(raw) as Partial<State>) : {}
      dispatch({ type: 'hydrate', state: { ...parsed, mandate: migrateMandate(parsed.mandate) } })
    } catch {
      dispatch({ type: 'hydrate', state: {} })
    }
  }, [])

  useEffect(() => {
    if (!state.hydrated) return
    try {
      const { hydrated: _hydrated, ...persisted } = state
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      // Storage unavailable (private mode / quota) — state stays in memory.
    }
  }, [state])

  const value = useMemo<Store>(() => {
    const active = state.positions.filter((p) => p.status !== 'closed')
    const totalCapital = active.reduce((sum, p) => sum + p.capital_usd, 0)
    const blendedCarry = totalCapital
      ? active.reduce((sum, p) => sum + p.current_net_carry * p.capital_usd, 0) / totalCapital
      : 0

    return {
      ...state,
      totalCapital,
      blendedCarry,
      setMandate: (mandate) => dispatch({ type: 'setMandate', mandate }),
      addPosition: (position) => dispatch({ type: 'addPosition', position }),
      closePosition: (id) => dispatch({ type: 'closePosition', id }),
      resolveEvent: (id, outcome) => dispatch({ type: 'resolveEvent', id, outcome }),
    }
  }, [state])

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}

export function useAgent(): Store {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgent must be used inside AgentProvider')
  return ctx
}
