import { describe, expect, it } from 'vitest'
import { recoverMessageAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { ACTIVATION_STATEMENT, buildSiwe, siweExpiry, siweProblem, SIWE_TTL_MS, type SiwePurpose } from './siwe'

const OWNER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const SAFE = '0x2e1c2be3dd6baa59344edc6ee6a93d68e2295a0f'
const origin = { domain: 'porthmos.vercel.app', uri: 'https://porthmos.vercel.app' }
const now = new Date('2026-10-17T12:00:00.000Z')
const owner: SiwePurpose = { kind: 'session', role: 'owner' }

describe('Sign-In with Ethereum message', () => {
  it('builds the exact EIP-4361 text the service rebuilds (aegis/siwe.py build)', () => {
    expect(buildSiwe({ purpose: owner, address: OWNER, chainId: 84532, nonce: 'a1b2c3d4e5f6a7b8', origin, now })).toBe([
      'porthmos.vercel.app wants you to sign in with your Ethereum account:',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '',
      'Sign in to Porthmos as owner.',
      '',
      'URI: https://porthmos.vercel.app',
      'Version: 1',
      'Chain ID: 84532',
      'Nonce: a1b2c3d4e5f6a7b8',
      'Issued At: 2026-10-17T12:00:00.000Z',
      'Expiration Time: 2026-10-17T12:10:00.000Z',
      'Resources:',
      '- urn:porthmos:role:owner',
    ].join('\n'))
  })

  it('parses back to the same fields and passes viem validation', () => {
    const text = buildSiwe({ purpose: { kind: 'session', role: 'bank' }, address: OWNER, chainId: 31337, nonce: 'n0nce12345', origin: { domain: 'localhost:5173', uri: 'http://localhost:5173' }, now })
    const m = parseSiweMessage(text)
    expect(m).toMatchObject({ domain: 'localhost:5173', uri: 'http://localhost:5173', chainId: 31337, nonce: 'n0nce12345', version: '1', statement: 'Sign in to Porthmos as bank.', resources: ['urn:porthmos:role:bank'] })
    expect(m.expirationTime!.getTime() - m.issuedAt!.getTime()).toBe(SIWE_TTL_MS)
    expect(validateSiweMessage({ message: m, domain: 'localhost:5173', nonce: 'n0nce12345', address: OWNER, time: now })).toBe(true)
    expect(validateSiweMessage({ message: m, domain: 'porthmos.vercel.app', time: now })).toBe(false)
    expect(siweExpiry(text)).toBe(now.getTime() + SIWE_TTL_MS)
  })

  it('names the Safe and the owner role in the activation message', () => {
    const m = parseSiweMessage(buildSiwe({ purpose: { kind: 'activate', safe: SAFE }, address: OWNER, chainId: 84532, nonce: 'abcdefgh12', origin, now }))
    expect(m.statement).toBe(ACTIVATION_STATEMENT)
    expect(m.resources).toEqual(['urn:porthmos:role:owner', 'urn:porthmos:safe:0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F'])
  })

  it('works for an IP origin', () => {
    const text = buildSiwe({ purpose: owner, address: OWNER, chainId: 31337, nonce: 'abcdefgh12', origin: { domain: '127.0.0.1:4173', uri: 'http://127.0.0.1:4173' }, now })
    expect(text.startsWith('127.0.0.1:4173 wants you')).toBe(true)
  })

  it('refuses a nonce the service would refuse', () => {
    expect(() => buildSiwe({ purpose: owner, address: OWNER, chainId: 1, nonce: 'short', origin, now })).toThrow()
  })

  it('signs with personal_sign and recovers to the address', async () => {
    const acct = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123')
    const message = buildSiwe({ purpose: owner, address: acct.address, chainId: 84532, nonce: 'abcdefgh12', origin, now })
    expect(await recoverMessageAddress({ message, signature: await acct.signMessage({ message }) })).toBe(acct.address)
  })
})

describe('check before signing', () => {
  const text = buildSiwe({ purpose: owner, address: OWNER, chainId: 84532, nonce: 'abcdefgh12', origin, now })
  const want = { purpose: owner, address: OWNER, chainId: 84532, origin, now } as const

  it('accepts the message it built', () => {
    expect(siweProblem(text, want)).toBeNull()
  })

  it('names what is wrong', () => {
    expect(siweProblem(text, { ...want, origin: { domain: 'evil.example', uri: 'https://evil.example' } })).toMatch(/evil.example/)
    expect(siweProblem(text, { ...want, chainId: 1 })).toMatch(/chain 84532/)
    expect(siweProblem(text, { ...want, purpose: { kind: 'session', role: 'bank' } })).toMatch(/statement/)
    expect(siweProblem(text, { ...want, address: SAFE })).toMatch(/different address/)
    expect(siweProblem(text, { ...want, now: new Date(now.getTime() + SIWE_TTL_MS + 1) })).toMatch(/expired/)
    expect(siweProblem(text.replace('urn:porthmos:role:owner', 'urn:porthmos:role:bank'), want)).toMatch(/resources/)
  })
})
