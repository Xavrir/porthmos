import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmCard } from '../components/ConfirmCard'
import { HttpApi } from './api/http'
import { confirmRequest, confirmStatus, countdown, holdText, proposalText, REPLY_MODE } from './confirm'
import type { ChatResponse, PendingConfirmation } from './types'

const RESPONSE: ChatResponse = {
  reply: 'I can deposit 3,300.00 USDC into Vault A. Confirm to run it.',
  requestId: 'req_7',
  state: 'EXPLAINED',
  replyMode: 'deterministic',
  holdReason: 'AwaitingConfirmation',
  pendingConfirmation: {
    requestId: 'req_7', op: 'DEPOSIT', vault: { address: '0x00000000000000000000000000000000000000a1', name: 'Vault A' },
    amount: { raw: '3300000000', display: '3,300.00' }, tier: 2, expiresAt: 1_000_300,
  },
}
const P = RESPONSE.pendingConfirmation as PendingConfirmation

const card = (props: Partial<Parameters<typeof ConfirmCard>[0]> = {}) =>
  renderToStaticMarkup(<ConfirmCard pending={P} latest busy={false} now={1_000_000} onChoose={() => {}} {...props} />)

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(Confirm|Cancel)<\/button>/g)].map((m) => ({ label: m[1], disabled: /\sdisabled=""/.test(m[0]) }))

describe('confirmation card', () => {
  it('renders the action, tier and countdown from a pendingConfirmation response', () => {
    const html = card()
    expect(html).toContain('Deposit 3,300.00 USDC into Vault A')
    expect(html).toContain('T2')
    expect(html).toContain('Expires in 5:00')
    expect(html).toContain('aria-live="polite"')
    expect(buttons(html)).toEqual([{ label: 'Confirm', disabled: false }, { label: 'Cancel', disabled: false }])
  })

  it('disables both buttons while a request is in flight', () => {
    const html = card({ busy: true })
    expect(buttons(html).every((b) => b.disabled)).toBe(true)
    expect(html).toContain('Waiting for the current reply')
  })

  it('disables both buttons after one is used', () => {
    for (const used of ['confirm', 'cancel'] as const) {
      const html = card({ used })
      expect(buttons(html).every((b) => b.disabled)).toBe(true)
      expect(html).toContain(used === 'confirm' ? 'You confirmed' : 'You cancelled')
    }
  })

  it('shows the expired state and hides the countdown', () => {
    const html = card({ now: 1_000_300 })
    expect(html).toContain('is-expired')
    expect(html).toContain('This proposal expired')
    expect(html).not.toContain('Expires in')
    expect(buttons(html).every((b) => b.disabled)).toBe(true)
  })

  it('closes when a newer message superseded it', () => {
    const html = card({ latest: false })
    expect(html).toContain('is-superseded')
    expect(buttons(html).every((b) => b.disabled)).toBe(true)
  })
})

describe('confirm logic', () => {
  it('words a redemption and a deposit', () => {
    expect(proposalText(P)).toBe('Deposit 3,300.00 USDC into Vault A')
    expect(proposalText({ ...P, op: 'REDEEM', vault: { ...P.vault, name: 'Vault B' } })).toBe('Redeem 3,300.00 USDC from Vault B')
  })

  it('ranks used over superseded over expired', () => {
    expect(confirmStatus(P, { latest: true, now: 0 })).toBe('open')
    expect(confirmStatus({ ...P, expiresAt: undefined }, { latest: true, now: 9e12 })).toBe('open')
    expect(confirmStatus(P, { latest: false, now: 2e6 })).toBe('superseded')
    expect(confirmStatus(P, { latest: false, used: 'confirm', now: 2e6 })).toBe('confirm')
  })

  it('binds confirm and cancel to the proposal requestId', () => {
    expect(confirmRequest('confirm', P)).toEqual({ message: 'confirm', requestId: 'req_7' })
    expect(confirmRequest('cancel', P)).toEqual({ message: 'cancel', requestId: 'req_7' })
  })

  it('formats the countdown and never goes negative', () => {
    expect(countdown(65.9)).toBe('1:05')
    expect(countdown(-3)).toBe('0:00')
  })

  it('labels the reply mode and the hold reason', () => {
    expect(REPLY_MODE.llm.label).toBe('LLM')
    expect(REPLY_MODE.deterministic.label).toBe('Rules')
    expect(REPLY_MODE.deterministic.title).toBe('Fixed template, no LLM')
    expect(holdText('NothingToConfirm')).toBe('Nothing open to confirm')
    expect(holdText('SuspiciousRequest')).toMatch(/^Refused/)
    expect(holdText('ReadOnly')).toBeNull()
    expect(holdText(undefined)).toBeNull()
    expect(holdText('SomeNewReason')).toBe('Some new reason')
  })
})

describe('HttpApi chat requestId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the requestId with a bound confirm, and omits it otherwise', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', f)
    const a = new HttpApi('http://svc')
    a.setSession('tok')
    await a.chatStream('confirm', {}, undefined, 'req_7')
    await a.chat('status')
    const bodies = (f.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [url, JSON.parse(String(init.body))])
    expect(bodies).toEqual([
      ['http://svc/api/agent/chat/stream', { message: 'confirm', requestId: 'req_7' }],
      ['http://svc/api/agent/chat', { message: 'confirm', requestId: 'req_7' }],
      ['http://svc/api/agent/chat', { message: 'status' }],
    ])
  })
})
