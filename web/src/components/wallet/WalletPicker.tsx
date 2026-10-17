import { createContext, useCallback, useContext, useEffect, useId, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { Address } from 'viem'
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain, type Connector } from 'wagmi'
import { Dialog } from '../Dialog'
import { Icon } from '../icons'
import { useAegis } from '../../lib/source'
import { chainName } from '../../lib/wallet'
import { addChainParams, connectReducer, hasInstalledWallet, INSTALL_LINKS, readLastWallet, rememberWallet, walletOptions, type ConnectState, type WalletOption } from '../../lib/wallets'
import { WalletAvatar } from './WalletAvatar'

export type Picked = { address: Address; chainId: number } | null
type Opener = (opts?: { reason?: string }) => Promise<Picked>

const PickerContext = createContext<{ open: Opener } | null>(null)

const net = (id: number | undefined) => chainName(id).replace(/ \(\d+\)$/, '')
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function hasWindowEthereum() {
  return typeof window !== 'undefined' && !!(window as { ethereum?: unknown }).ethereum
}

function WalletMark({ option, size = 32 }: { option: WalletOption; size?: number }) {
  if (option.icon) return <img className="wp-icon" src={option.icon} width={size} height={size} alt="" />
  return (
    <span className={`wp-icon wp-glyph wp-glyph-${option.kind}`} aria-hidden="true" style={{ width: size, height: size }}>
      <Icon name={option.kind === 'walletconnect' ? 'qr' : option.kind === 'smart' ? 'key' : 'wallet'} />
    </span>
  )
}

function Spinner() {
  return <span className="wp-spinner" aria-hidden="true" />
}

export function WalletPickerProvider({ children }: { children: ReactNode }) {
  const { chainId, onboard } = useAegis()
  const target = onboard?.chainId ?? chainId
  const conn = useConnection()
  const connectors = useConnectors()
  const { mutateAsync: connectAsync } = useConnect()
  const { mutateAsync: switchChain } = useSwitchChain()
  const { mutateAsync: disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [reason, setReason] = useState<string | undefined>()
  const reducer = useMemo(() => connectReducer(target), [target])
  const [state, dispatch] = useReducer(reducer, { step: 'list' } as ConnectState)
  const resolver = useRef<((p: Picked) => void) | null>(null)
  const titleId = useId()
  const last = readLastWallet()
  const options = useMemo(() => walletOptions(connectors, { lastId: last, legacyInjected: hasWindowEthereum() }), [connectors, last])
  const picking = state.step === 'connecting' || state.step === 'rejected' || state.step === 'error' ? options.find((o) => o.id === state.walletId) : undefined

  const finish = useCallback((p: Picked) => {
    resolver.current?.(p)
    resolver.current = null
    setOpen(false)
    setHidden(false)
  }, [])

  const openPicker: Opener = useCallback((opts) => {
    resolver.current?.(null)
    setReason(opts?.reason)
    if (conn.address && conn.chainId) dispatch({ type: 'connected', address: conn.address, chainId: conn.chainId })
    else dispatch({ type: 'back' })
    setOpen(true)
    return new Promise<Picked>((resolve) => { resolver.current = resolve })
  }, [conn.address, conn.chainId])

  useEffect(() => {
    if (!open || !conn.chainId) return
    if (state.step === 'wrong-network' || state.step === 'connected') dispatch({ type: 'chain', chainId: conn.chainId })
    // only a chain change reported by the wallet moves the state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.chainId, open])

  const pick = async (o: WalletOption) => {
    const connector = connectors.find((c) => c.id === o.id) as Connector | undefined
    if (!connector) return
    dispatch({ type: 'pick', walletId: o.id })
    // WalletConnect draws its own QR window; a modal <dialog> would make it inert, so ours steps aside meanwhile.
    if (o.kind === 'walletconnect') setHidden(true)
    try {
      if (conn.address) await disconnect().catch(() => undefined)
      const r = await connectAsync({ connector })
      rememberWallet(o.id)
      dispatch({ type: 'connected', address: r.accounts[0], chainId: r.chainId })
    } catch (e) {
      dispatch({ type: 'failed', error: e, message: `${o.name} did not connect. Open the wallet to check it is unlocked, then try again.` })
    } finally {
      setHidden(false)
    }
  }

  const doSwitch = async () => {
    dispatch({ type: 'switch' })
    try {
      const params = addChainParams(target)
      const r = await switchChain({ chainId: target as 31337 | 84532, addEthereumChainParameter: params ? { chainName: params.chainName, nativeCurrency: params.nativeCurrency, rpcUrls: params.rpcUrls, blockExplorerUrls: params.blockExplorerUrls } : undefined })
      dispatch({ type: 'switched', chainId: r.id })
    } catch (e) {
      dispatch({ type: 'switch-failed', error: e })
    }
  }

  const other = async () => {
    await disconnect().catch(() => undefined)
    dispatch({ type: 'back' })
  }

  const installed = hasInstalledWallet(options)
  const value = useMemo(() => ({ open: openPicker }), [openPicker])

  return (
    <PickerContext.Provider value={value}>
      {children}
      <Dialog open={open && !hidden} onClose={() => finish(null)} labelledBy={titleId} className="dialog-wallet">
        <div className="dialog-body wp">
          <div className="dialog-head">
            <h2 id={titleId}>{state.step === 'wrong-network' || state.step === 'switching' ? 'Switch network' : state.step === 'connected' ? 'Wallet connected' : 'Connect a wallet'}</h2>
            <button type="button" className="icon-button wp-close" aria-label="Close" onClick={() => finish(null)}><Icon name="close" /></button>
          </div>

          {state.step === 'list' ? (
            <>
              <p className="wp-lede">{reason ?? `Your wallet is your Porthmos account. Connecting shares only your address. Nothing is signed or sent yet.`}</p>
              {!installed ? (
                <div className="wp-none" role="group" aria-labelledby={`${titleId}-none`}>
                  <p id={`${titleId}-none`}><strong>No wallet found in this browser.</strong> Install one, then come back to this page.</p>
                  <div className="wp-install">
                    {INSTALL_LINKS.map((l) => (
                      <a key={l.href} className="wp-install-link" href={l.href} target="_blank" rel="noopener noreferrer">Install {l.name}<Icon name="external" /><span className="sr-only"> (opens in a new tab)</span></a>
                    ))}
                  </div>
                  {options.length ? <p className="wp-muted">Or use one of these, no extension needed:</p> : null}
                </div>
              ) : null}
              {options.length ? (
                <ul className="wp-list" aria-label="Wallets">
                  {options.map((o) => (
                    <li key={o.id}>
                      <button type="button" className="wp-item" data-wallet={o.id} onClick={() => void pick(o)}>
                        <WalletMark option={o} />
                        <span className="wp-name">{o.name}<span className="wp-detail">{o.detail}</span></span>
                        {o.last ? <span className="wp-badge">Last used</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="wp-muted">Porthmos runs on {net(target)}, a test network. Never send real funds to it.</p>
            </>
          ) : null}

          {state.step === 'connecting' ? (
            <div className="wp-state" role="status" aria-live="polite">
              {picking ? <WalletMark option={picking} size={48} /> : null}
              <Spinner />
              <p className="wp-state-title">Open {picking?.name ?? 'your wallet'}</p>
              <p className="wp-muted">Confirm the connection there. Porthmos only sees your address.</p>
              <button type="button" className="button small quiet" onClick={() => dispatch({ type: 'back' })}>Cancel</button>
            </div>
          ) : null}

          {state.step === 'rejected' || state.step === 'error' ? (
            <div className="wp-state" role="alert">
              {picking ? <WalletMark option={picking} size={48} /> : null}
              <p className="wp-state-title">{state.step === 'rejected' ? 'Request declined' : 'Not connected'}</p>
              <p className="wp-muted">{state.step === 'rejected' ? `You declined in ${picking?.name ?? 'your wallet'}. Nothing was shared.` : state.message}</p>
              <div className="row-actions">
                {picking ? <button type="button" className="button small" onClick={() => void pick(picking)}>Try again</button> : null}
                <button type="button" className="button small quiet" onClick={() => dispatch({ type: 'back' })}>Choose another wallet</button>
              </div>
            </div>
          ) : null}

          {state.step === 'wrong-network' || state.step === 'switching' ? (
            <div className="wp-state" role={state.step === 'wrong-network' && state.note ? 'alert' : 'status'} aria-live="polite">
              <WalletAvatar address={state.address as Address} size={48} />
              <p className="wp-state-title">Your wallet is on {net(state.chainId)}</p>
              <p className="wp-muted">Porthmos runs on {net(target)} (chain {target}). If your wallet does not know it yet, it asks to add it with the public RPC {addChainParams(target)?.rpcUrls[0]}{addChainParams(target)?.blockExplorerUrls ? ' and Basescan' : ''}.</p>
              {state.step === 'wrong-network' && state.note ? <p className="wp-note">{state.note}</p> : null}
              <div className="row-actions">
                <button type="button" className="button small" id="wp-switch" disabled={state.step === 'switching'} onClick={() => void doSwitch()}>
                  {state.step === 'switching' ? <><Spinner /> Approve in your wallet…</> : `Switch to ${net(target)}`}
                </button>
                <button type="button" className="button small quiet" onClick={() => void other()}>Use another wallet</button>
              </div>
            </div>
          ) : null}

          {state.step === 'connected' ? (
            <div className="wp-state">
              <WalletAvatar address={state.address as Address} size={48} />
              <p className="wp-state-title"><code>{short(state.address)}</code></p>
              <p className="wp-muted"><span className="net-dot is-ok" aria-hidden="true" />{net(state.chainId)}</p>
              <div className="row-actions">
                <button type="button" className="button small" id="wp-continue" onClick={() => finish({ address: state.address as Address, chainId: state.chainId })}>Continue</button>
                <button type="button" className="button small quiet" onClick={() => void other()}>Use another wallet</button>
              </div>
            </div>
          ) : null}
        </div>
      </Dialog>
    </PickerContext.Provider>
  )
}

export function useWalletPicker(): { open: Opener } {
  const ctx = useContext(PickerContext)
  if (!ctx) throw new Error('useWalletPicker outside WalletPickerProvider')
  return ctx
}
