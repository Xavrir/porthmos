import { useNavigate } from 'react-router-dom'
import { gate, homeFor, returnPath, type Gate } from '../lib/auth'
import { useIdentity } from '../lib/identity'
import { useAegis } from '../lib/source'
import type { Role } from '../lib/types'

export function useGate(): Gate {
  const { phase, mode, replayChosen } = useAegis()
  const { identity, confirmed, signedIn, storedSignIn, restoring } = useIdentity()
  return gate({
    phase, mode, replayChosen, signedIn, storedSignIn, restoring,
    identity: identity.kind,
    localConfirmed: identity.kind === 'local' && confirmed(identity.role),
  })
}

export function useViewDemo() {
  const { switchMode } = useAegis()
  const { chooseSeat } = useIdentity()
  const navigate = useNavigate()
  return (seat: Role, from?: unknown) => {
    chooseSeat(seat)
    switchMode('replay')
    navigate(returnPath(from, homeFor(seat)))
  }
}

export function useSignOut() {
  const { forgetReplay } = useAegis()
  const { signOut } = useIdentity()
  const navigate = useNavigate()
  return () => {
    signOut()
    forgetReplay()
    navigate('/signin', { replace: true })
  }
}
