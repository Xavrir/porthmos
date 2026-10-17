import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { useIdentity, type Prepared } from './identity'
import type { Role } from './types'

// Fetches a nonce and builds the exact message to show, then rebuilds it a minute and a half before it expires,
// so the text on screen is always the text that will be signed.
export function useSiwePreview(role: Role | null, address: Address | null, enabled: boolean) {
  const { prepareSignIn } = useIdentity()
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!enabled || !role || !address) { setPrepared(null); setError(null); return }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const p = await prepareSignIn(role, address)
        if (!alive) return
        setPrepared(p)
        setError(null)
        timer = setTimeout(load, Math.max(5_000, p.expiresAt - Date.now() - 90_000))
      } catch (e) {
        if (alive) setError((e as Error).message || 'Could not reach the Porthmos service.')
      }
    }
    setPrepared(null)
    void load()
    return () => { alive = false; clearTimeout(timer) }
    // prepareSignIn changes with every identity render; a new message is needed only for a new role, address or retry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, role, address, round])
  return { prepared, error, retry: () => setRound((n) => n + 1) }
}
