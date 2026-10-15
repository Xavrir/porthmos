import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'
import { TIERS } from '../lib/vocabulary'
import type { Tier } from '../lib/types'

export const GLOSSARY: { term: string; def: string }[] = [
  { term: 'DAR (Decision Authorization Record)', def: 'The record the authorizer signs for one action: the vault, the amount, a price band, the policy version, a nonce and a 120-second expiry. The contract executes nothing without one.' },
  { term: 'EIP-712', def: 'A standard for signing typed data field by field. If any field changes after signing, the signature recovers to a different address and the contract refuses the record.' },
  { term: 'Approval', def: 'What the owner signs (and the bank too, for tier 4): a ceiling, one vault, a policy version and 24 hours. The agent can never go above it.' },
  ...([1, 2, 3, 4] as Tier[]).map((t) => ({ term: `T${t}, ${TIERS[t].name.toLowerCase()}`, def: `${TIERS[t].when}. Signed by: ${TIERS[t].signers.toLowerCase()}.` })),
  { term: 'Nonce', def: 'A random number in each record. The contract marks it used on execution, so a copy of the same record is refused with NonceUsed.' },
  { term: 'Typed error', def: 'The contract’s named reason for refusing a transaction, such as BadSignature or Frozen. A refused transaction moves nothing.' },
  { term: 'Policy version', def: 'A counter in the PolicyRegistry. Every policy change raises it, which voids every record signed under the old policy.' },
  { term: 'Reserve floor', def: 'Cash the Safe must keep for what the business owes. The owner signs it on-chain; a deposit that would cross it reverts ReserveFloorBreached.' },
  { term: 'Quarantine', def: 'A vault flag set after a risk trigger. Deposits into it are refused; exits back to the Safe still run. Only the owner clears it, after 24 quiet hours.' },
  { term: 'Authorizer and exit key', def: 'The two machine keys. The authorizer signs deposits and redemptions after checking them again; the exit key can only redeem back to the Safe.' },
  { term: 'Simulation (eth_call)', def: 'A dry run of the transaction against the current chain state, without sending it. AEGIS simulates before anyone signs.' },
  { term: 'Calldata', def: 'The encoded function call a transaction carries. The language model never writes it; tested code builds it from the chosen plan.' },
  { term: 'ERC-4626 vault', def: 'The standard interface for yield vaults: deposit USDC, receive shares, redeem shares for USDC.' },
  { term: 'Safe', def: 'The business’s smart account that holds the USDC. AEGIS is a module on it that can only deposit into owner-added vaults or redeem back.' },
  { term: 'Replay', def: 'A recorded run played inside your browser over the Base Sepolia contract addresses. Nothing you do in Replay sends a transaction.' },
]

const def = (prefix: string) => GLOSSARY.find((g) => g.term.startsWith(prefix))?.def ?? ''

export const GLOSSARY_DEF = {
  calldata: def('Calldata'),
  erc4626: def('ERC-4626'),
  dar: def('DAR'),
  eip712: def('EIP-712'),
  nonce: def('Nonce'),
}

export function GlossaryList() {
  return (
    <dl className="glossary">
      {GLOSSARY.map((g) => (
        <div key={g.term}>
          <dt>{g.term}</dt>
          <dd>{g.def}</dd>
        </div>
      ))}
    </dl>
  )
}

export function GlossaryButton({ className, label = 'Terms' }: { className?: string; label?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy={id} className="dialog-glossary">
        <div className="dialog-body">
          <div className="dialog-head">
            <h2 id={id}>What the terms mean</h2>
            <button type="button" className="button small quiet" onClick={() => setOpen(false)}>Close</button>
          </div>
          <GlossaryList />
        </div>
      </Dialog>
    </>
  )
}

export function Term({ children, def, className }: { children: ReactNode; def: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <span className={`term${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} ref={ref}>
      <button type="button" className="term-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {children}
      </button>
      <span id={id} className="term-pop" role="note" hidden={!open}>{def}</span>
    </span>
  )
}
