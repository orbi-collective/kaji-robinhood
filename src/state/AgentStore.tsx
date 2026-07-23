import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { AgentEvent, Mandate, Position } from '../lib/types'

/**
 * Agent state: the mandate, deployed positions and the event log.
 * Persisted to localStorage so a reload never loses a user's mandate — this is
 * the one thing they spent real thought on.
 */

type State = {
  mandate: Mandate | null
  positions: Position[]
  events: AgentEvent[]
  agentPaused: boolean
  killSwitchAt: number | null
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
  | { type: 'setPaused'; paused: boolean }
  | { type: 'killSwitch' }

const STORAGE_KEY = 'kaji.agent.v1'

const initialState: State = {
  mandate: null,
  positions: [],
  events: [],
  agentPaused: false,
  killSwitchAt: null,
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
        events: [event('executed', 'Mandate updated', 'Constraints recompiled and applied to the policy engine.'), ...state.events],
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
    case 'setPaused':
      return {
        ...state,
        agentPaused: action.paused,
        events: [
          event(
            action.paused ? 'paused' : 'executed',
            action.paused ? 'Agent paused' : 'Agent resumed',
            action.paused
              ? 'No further actions will be prepared until you resume.'
              : 'Monitoring resumed under the current mandate.',
          ),
          ...state.events,
        ],
      }
    case 'killSwitch':
      return {
        ...state,
        agentPaused: true,
        killSwitchAt: Date.now(),
        positions: state.positions.map((p) => (p.status === 'active' ? { ...p, status: 'paused' } : p)),
        events: [
          event('paused', 'Emergency stop engaged', 'Session access revoked. All positions held, no actions prepared.'),
          ...state.events,
        ],
      }
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
  setPaused: (paused: boolean) => void
  killSwitch: () => void
  totalCapital: number
  blendedCarry: number
}

const AgentContext = createContext<Store | null>(null)

export function AgentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      dispatch({ type: 'hydrate', state: raw ? (JSON.parse(raw) as Partial<State>) : {} })
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
      setPaused: (paused) => dispatch({ type: 'setPaused', paused }),
      killSwitch: () => dispatch({ type: 'killSwitch' }),
    }
  }, [state])

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}

export function useAgent(): Store {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgent must be used inside AgentProvider')
  return ctx
}
