import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { onTick, reducedMotion } from './Count'
import { easeEnter } from '../lib/motion'
import { GATES, STATE_GATE, type Gate } from '../lib/vocabulary'
import type { ErrorName, StateTransition, WorkflowState } from '../lib/types'
import { clock } from '../lib/format'

export type GateStatus = 'done' | 'current' | 'failed' | 'held' | 'todo'

const FAIL_STATES: Partial<Record<WorkflowState, Gate>> = {
  POLICY_REJECTED: 'policy', SIM_FAILED: 'simulation', APPROVAL_DENIED: 'signature', REVERTED: 'guard',
}

export function gateStatuses(history: StateTransition[]): { status: Record<Gate, GateStatus>; notes: Partial<Record<Gate, StateTransition>> } {
  const order = GATES.map((g) => g.id)
  const status = Object.fromEntries(order.map((g) => [g, 'todo'])) as Record<Gate, GateStatus>
  const notes: Partial<Record<Gate, StateTransition>> = {}
  let reached = -1
  let last: WorkflowState | null = null
  for (const t of history) {
    if (t.state === 'EXPLAINED') continue
    last = t.state
    const failed = FAIL_STATES[t.state]
    const g = failed ?? STATE_GATE[t.state]
    if (!g) continue
    const idx = order.indexOf(g)
    if (idx >= reached || failed) {
      reached = Math.max(reached, idx)
      notes[g] = t
    }
  }
  if (reached < 0) return { status, notes }
  for (let i = 0; i < reached; i++) status[order[i]] = 'done'
  const g = order[reached]
  if (last && FAIL_STATES[last]) status[FAIL_STATES[last]!] = 'failed'
  else if (last === 'CONFIRMED') { status.guard = 'done'; status.execute = 'done' }
  else if (last === 'HELD' || last === 'CANCELLED' || last === 'NEEDS_CLARIFICATION') status[g] = 'held'
  else status[g] = 'current'
  return { status, notes }
}

export function DecisionChain({ history, revertReason, compact = false }: { history: StateTransition[]; revertReason?: ErrorName; compact?: boolean }) {
  const { status, notes } = gateStatuses(history)
  const listRef = useRef<HTMLOListElement>(null)
  const seen = useRef<{ id: string; status: Record<Gate, GateStatus> } | null>(null)
  const id = history.length ? `${history[0].state}@${history[0].at}` : ''
  const signature = GATES.map((g) => status[g.id]).join(',')

  useLayoutEffect(() => {
    const prev = seen.current
    seen.current = { id, status }
    if (!prev || prev.id !== id || !listRef.current || reducedMotion()) return
    const changed = GATES.map((g, i) => (prev.status[g.id] !== status[g.id] ? listRef.current!.children[i] : null)).filter(Boolean) as Element[]
    if (changed.length) return onTick(() => { gsap.fromTo(changed, { yPercent: -14, autoAlpha: 0.4 }, { yPercent: 0, autoAlpha: 1, duration: 0.3, ease: easeEnter, stagger: 0.08 }) })
    // status is derived from history; the joined signature is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, signature])

  return (
    <ol ref={listRef} className={`chain${compact ? ' is-compact' : ''}`} aria-label="Decision chain">
      {GATES.map((g) => {
        const s = status[g.id]
        const n = notes[g.id]
        return (
          <li key={g.id} className={`gate g-${s}`}>
            <span className="gate-name">{g.name}</span>
            <span className="gate-status">
              {s === 'done' ? 'Passed' : s === 'failed' ? (g.id === 'guard' && revertReason ? `Refused: ${revertReason}` : 'Stopped') : s === 'held' ? 'Held' : s === 'current' ? 'In progress' : 'Not reached'}
            </span>
            {!compact && n ? <span className="gate-note">{clock(n.at)}{n.note ? `. ${n.note}` : ''}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}
