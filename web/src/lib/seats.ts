import { useNavigate } from 'react-router-dom'
import { useAegis } from './source'
import { useIdentity, type Seat } from './identity'

export type PickResult = 'done' | 'confirm' | 'start' | 'wallet'

export function useSeatPicker() {
  const { tenant, service, onboard, wallet, mode, refresh } = useAegis()
  const { chooseSeat, confirmed, signInLocal } = useIdentity()
  const navigate = useNavigate()
  const multi = service === 'up' && !!onboard
  const pick = (s: Seat): PickResult => {
    if (s === 'viewer') {
      chooseSeat('viewer')
      if (mode === 'live') refresh('replay')
      return 'done'
    }
    if (!tenant) {
      navigate('/start')
      return 'start'
    }
    if (s === 'owner' && wallet?.owner.type === 'injected') {
      chooseSeat('owner')
      if (mode !== 'live') refresh('live')
      return 'wallet'
    }
    if (confirmed(s)) {
      signInLocal(s)
      return 'done'
    }
    return 'confirm'
  }
  return { multi, pick, tenant, hasKeys: !!wallet }
}
