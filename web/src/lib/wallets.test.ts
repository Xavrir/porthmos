import { describe, expect, it } from 'vitest'
import { addChainParams, connectReducer, hasInstalledWallet, networkStatus, safeIcon, walletErrorKind, walletOptions, type ConnectState, type ConnectorLike } from './wallets'
import { blockie, blockieSvg } from './identicon'

const ICON = 'data:image/svg+xml;base64,PHN2Zy8+'
const mm: ConnectorLike = { id: 'io.metamask', name: 'MetaMask', type: 'injected', icon: ICON, rdns: 'io.metamask' }
const rabby: ConnectorLike = { id: 'io.rabby', name: 'Rabby Wallet', type: 'injected', icon: ICON, rdns: 'io.rabby' }
const cbExt: ConnectorLike = { id: 'com.coinbase.wallet', name: 'Coinbase Wallet', type: 'injected', icon: ICON, rdns: 'com.coinbase.wallet' }
const generic: ConnectorLike = { id: 'injected', name: 'Injected', type: 'injected' }
const smart: ConnectorLike = { id: 'coinbaseWalletSDK', name: 'Coinbase Wallet', type: 'coinbaseWallet' }
const wc: ConnectorLike = { id: 'walletConnect', name: 'WalletConnect', type: 'walletConnect' }

describe('EIP-6963 wallet list', () => {
  it('lists every announced wallet with its own name and icon, then Smart Wallet and WalletConnect', () => {
    const list = walletOptions([generic, smart, mm, rabby, cbExt, wc], { legacyInjected: true })
    expect(list.map((w) => [w.id, w.name, w.kind])).toEqual([
      ['io.metamask', 'MetaMask', 'injected'], ['io.rabby', 'Rabby Wallet', 'injected'], ['com.coinbase.wallet', 'Coinbase Wallet', 'injected'],
      ['coinbaseWalletSDK', 'Coinbase Smart Wallet', 'smart'], ['walletConnect', 'WalletConnect', 'walletconnect'],
    ])
    expect(list[0].icon).toBe(ICON)
    expect(hasInstalledWallet(list)).toBe(true)
  })

  it('shows the legacy window.ethereum entry only when no wallet announced itself', () => {
    expect(walletOptions([generic, smart], { legacyInjected: true }).map((w) => w.id)).toEqual(['injected', 'coinbaseWalletSDK'])
    expect(walletOptions([generic, smart], { legacyInjected: false }).map((w) => w.id)).toEqual(['coinbaseWalletSDK'])
    expect(hasInstalledWallet(walletOptions([generic, smart], { legacyInjected: false }))).toBe(false)
  })

  it('drops duplicate announcements by rdns or name', () => {
    const twice = { ...mm, id: 'io.metamask.flask', rdns: 'io.metamask.flask', name: ' MetaMask ' }
    expect(walletOptions([mm, mm, twice], { legacyInjected: false }).map((w) => w.id)).toEqual(['io.metamask'])
  })

  it('puts the last used wallet first with a badge', () => {
    const list = walletOptions([mm, rabby, smart], { lastId: 'coinbaseWalletSDK', legacyInjected: false })
    expect(list.map((w) => [w.id, w.last])).toEqual([['coinbaseWalletSDK', true], ['io.metamask', false], ['io.rabby', false]])
    expect(walletOptions([mm], { lastId: 'gone', legacyInjected: false })[0].last).toBe(false)
  })

  it('shows nothing about WalletConnect when the connector is not configured', () => {
    expect(walletOptions([mm, smart], { legacyInjected: false }).some((w) => w.kind === 'walletconnect')).toBe(false)
  })

  it('only renders data: image icons', () => {
    expect(safeIcon(ICON)).toBe(ICON)
    expect(safeIcon('https://evil.example/x.png')).toBeNull()
    expect(safeIcon('javascript:alert(1)')).toBeNull()
    expect(safeIcon('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(walletOptions([{ ...mm, icon: 'https://x/y.png' }], { legacyInjected: false })[0].icon).toBeNull()
  })
})

describe('wrong network handling', () => {
  const reduce = connectReducer(84532)
  const run = (events: Parameters<typeof reduce>[1][], from: ConnectState = { step: 'list' }) => events.reduce(reduce, from)
  const A = '0x1111111111111111111111111111111111111111'

  it('connects straight through on the right chain', () => {
    expect(run([{ type: 'pick', walletId: 'io.metamask' }, { type: 'connected', address: A, chainId: 84532 }])).toEqual({ step: 'connected', address: A, chainId: 84532 })
  })

  it('stops on the wrong network, switches, then connects', () => {
    const wrong = run([{ type: 'pick', walletId: 'io.metamask' }, { type: 'connected', address: A, chainId: 1 }])
    expect(wrong).toEqual({ step: 'wrong-network', address: A, chainId: 1 })
    expect(run([{ type: 'switch' }], wrong)).toEqual({ step: 'switching', address: A, chainId: 1 })
    expect(run([{ type: 'switch' }, { type: 'switched', chainId: 84532 }], wrong).step).toBe('connected')
  })

  it('keeps the wrong-network state with a plain note when the switch fails or is declined', () => {
    const wrong: ConnectState = { step: 'wrong-network', address: A, chainId: 1 }
    expect(run([{ type: 'switch' }, { type: 'switch-failed', error: { code: 4001, message: 'User rejected the request.' } }], wrong)).toMatchObject({ step: 'wrong-network', note: 'You declined the switch in your wallet.' })
    expect(run([{ type: 'switch' }, { type: 'switch-failed', error: { code: 4200 } }], wrong)).toMatchObject({ note: expect.stringMatching(/cannot switch/) })
  })

  it('follows chainChanged from the wallet in both directions', () => {
    const ok: ConnectState = { step: 'connected', address: A, chainId: 84532 }
    expect(run([{ type: 'chain', chainId: 8453 }], ok)).toEqual({ step: 'wrong-network', address: A, chainId: 8453 })
    expect(run([{ type: 'chain', chainId: 8453 }, { type: 'chain', chainId: 84532 }], ok).step).toBe('connected')
  })

  it('tells a declined connection from a pending request and other errors', () => {
    const connecting: ConnectState = { step: 'connecting', walletId: 'x' }
    expect(reduce(connecting, { type: 'failed', error: { cause: { code: 4001 } } })).toEqual({ step: 'rejected', walletId: 'x' })
    expect(reduce(connecting, { type: 'failed', error: { code: -32002 } })).toMatchObject({ step: 'error', message: expect.stringMatching(/already has a request/) })
    expect(reduce(connecting, { type: 'failed', error: new Error('boom'), message: 'It broke.' })).toEqual({ step: 'error', walletId: 'x', message: 'It broke.' })
    expect(reduce({ step: 'list' }, { type: 'failed', error: {} })).toEqual({ step: 'list' })
  })

  it('classifies wallet errors', () => {
    expect(walletErrorKind({ code: 4902 })).toBe('unknown-chain')
    expect(walletErrorKind({ shortMessage: 'User rejected the request.' })).toBe('rejected')
    expect(walletErrorKind({ message: 'Unrecognized chain ID "0x14a34".' })).toBe('unknown-chain')
    expect(walletErrorKind(new Error('nope'))).toBe('failed')
  })

  it('compares the wallet chain with the app chain', () => {
    expect(networkStatus(84532, 84532)).toBe('ok')
    expect(networkStatus(1, 84532)).toBe('wrong')
    expect(networkStatus(undefined, 84532)).toBe('unknown')
  })

  it('adds Base Sepolia with the public RPC and Basescan', () => {
    expect(addChainParams(84532)).toEqual({
      chainId: '0x14a34', chainName: 'Base Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'],
    })
    expect(addChainParams(31337)?.chainId).toBe('0x7a69')
    expect(addChainParams(1)).toBeNull()
  })
})

describe('identicon', () => {
  const a = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  it('is deterministic, case-insensitive and mirrored', () => {
    expect(blockieSvg(a)).toBe(blockieSvg(a.toLowerCase()))
    const { cells } = blockie(a)
    expect(cells.length).toBe(64)
    for (let y = 0; y < 8; y++) expect(cells.slice(y * 8, y * 8 + 8)).toEqual([...cells.slice(y * 8, y * 8 + 8)].reverse())
    expect(cells.every((c) => c === 0 || c === 1 || c === 2)).toBe(true)
  })
  it('differs between addresses', () => {
    expect(blockieSvg(a)).not.toBe(blockieSvg('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'))
  })
})
