import { useEffect, useId, useRef, useState } from 'react'
import type { Address } from 'viem'
import { useConnection, useDisconnect, useSwitchChain } from 'wagmi'
import { useSignOut } from '../../auth/hooks'
import { useEnsName } from '../../lib/ens'
import { useIdentity } from '../../lib/identity'
import { useAegis } from '../../lib/source'
import { addChainParams, networkStatus } from '../../lib/wallets'
import { chainName, explorerAddress } from '../../lib/wallet'
import { Icon } from '../icons'
import { WalletAvatar } from './WalletAvatar'

const net = (id: number | undefined) => chainName(id).replace(/ \(\d+\)$/, '')
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function keyLabel(kind: 'wallet' | 'local' | 'demo', role: 'owner' | 'bank'): string {
  if (kind === 'wallet') return 'Your wallet'
  if (kind === 'demo') return 'Public Anvil test key (chain 31337 only)'
  return role === 'bank' ? 'Bank seat key, kept in this browser for testnet' : 'Owner test key, kept in this browser for testnet'
}

export function useSwitchToApp() {
  const { chainId, onboard } = useAegis()
  const target = onboard?.chainId ?? chainId
  const { mutateAsync, isPending } = useSwitchChain()
  const run = async () => {
    const p = addChainParams(target)
    await mutateAsync({ chainId: target as 31337 | 84532, addEthereumChainParameter: p ? { chainName: p.chainName, nativeCurrency: p.nativeCurrency, rpcUrls: p.rpcUrls, blockExplorerUrls: p.blockExplorerUrls } : undefined })
  }
  return { target, run, isPending }
}

export function AccountMenu() {
  const { identity, signedIn } = useIdentity()
  const { chainId, mode } = useAegis()
  const conn = useConnection()
  const { mutate: disconnect } = useDisconnect()
  const signOut = useSignOut()
  const sw = useSwitchToApp()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()
  const address: Address | null = identity.kind === 'wallet' || identity.kind === 'local' || identity.kind === 'demo' ? identity.address : null
  const ens = useEnsName(address, open && identity.kind === 'wallet' && chainId === 84532)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (mode !== 'live' || !address || identity.kind === 'none' || identity.kind === 'replay') return null
  const isWallet = identity.kind === 'wallet'
  const status = isWallet ? networkStatus(conn.chainId, sw.target) : 'ok'
  const explorer = explorerAddress(sw.target, address)
  const role = identity.role ?? 'owner'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked: the full address is shown to select by hand */ }
  }

  return (
    <div className="acct" ref={ref}>
      <button ref={btn} type="button" className="acct-button" id="account-menu" aria-expanded={open} aria-controls={id} aria-label={`Account ${short(address)}${status === 'wrong' ? ', wrong network' : ''}`} onClick={() => setOpen((o) => !o)}>
        <WalletAvatar address={address} size={24} />
        <span className="acct-short wide-only">{ens.data ?? short(address)}</span>
        {status === 'wrong' ? <span className="net-dot is-bad" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="acct-panel" id={id} role="dialog" aria-label="Account">
          <div className="acct-head">
            <WalletAvatar address={address} size={40} />
            <div className="acct-who">
              {ens.data ? <p className="acct-ens">{ens.data}</p> : null}
              <p className="acct-addr"><code className="break">{address}</code></p>
              <p className="acct-key">{keyLabel(identity.kind, role)}{signedIn ? ` · signed in as ${role === 'bank' ? 'bank' : 'owner'}` : ''}</p>
            </div>
          </div>
          <div className={`acct-net${status === 'wrong' ? ' is-wrong' : ''}`}>
            <span className={`net-dot ${status === 'wrong' ? 'is-bad' : 'is-ok'}`} aria-hidden="true" />
            <span>{isWallet ? (status === 'wrong' ? `Wallet on ${net(conn.chainId)}` : net(conn.chainId ?? sw.target)) : `${net(sw.target)} (key in this browser)`}</span>
            {status === 'wrong' ? (
              <button type="button" className="button small" id="account-switch" disabled={sw.isPending} onClick={() => { setSwitchError(null); sw.run().catch(() => setSwitchError('The wallet did not switch. Switch it in the wallet itself.')) }}>
                {sw.isPending ? 'Approve in your wallet…' : `Switch to ${net(sw.target)}`}
              </button>
            ) : null}
          </div>
          {switchError ? <p className="error-note" role="alert">{switchError}</p> : null}
          <div className="acct-actions">
            <button type="button" className="acct-action" id="account-copy" onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy address'}</button>
            {explorer ? <a className="acct-action" id="account-explorer" href={explorer} target="_blank" rel="noopener noreferrer"><Icon name="external" />View on Basescan<span className="sr-only"> (opens in a new tab)</span></a> : null}
            {isWallet ? (
              <button type="button" className="acct-action" id="account-disconnect" onClick={() => { setOpen(false); signOut(); disconnect() }}><Icon name="logout" />Disconnect</button>
            ) : (
              <button type="button" className="acct-action" id="account-signout-menu" onClick={() => { setOpen(false); signOut() }}><Icon name="logout" />Sign out</button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function NetworkBanner() {
  const { identity } = useIdentity()
  const { mode } = useAegis()
  const conn = useConnection()
  const sw = useSwitchToApp()
  const [error, setError] = useState<string | null>(null)
  if (mode !== 'live' || identity.kind !== 'wallet' || networkStatus(conn.chainId, sw.target) !== 'wrong') return null
  return (
    <div className="net-banner" role="region" aria-label="Wrong network">
      <p><strong>Your wallet is on {net(conn.chainId)}.</strong> Porthmos runs on {net(sw.target)}, so wallet requests are paused until you switch.{error ? ` ${error}` : ''}</p>
      <button type="button" className="button small" id="banner-switch" disabled={sw.isPending} onClick={() => { setError(null); sw.run().catch(() => setError('The wallet did not switch; switch it in the wallet itself.')) }}>
        {sw.isPending ? 'Approve in your wallet…' : `Switch to ${net(sw.target)}`}
      </button>
    </div>
  )
}
