import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverMessageAddress } from 'viem'
import { onboardingMessage, sessionMessage } from './messages'

const owner = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const bank = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'
const at = '2026-10-15T12:00:00.000Z'

describe('onboarding message', () => {
  it('matches the spec byte for byte, with checksummed addresses', () => {
    expect(onboardingMessage(owner, bank, 84532, at)).toBe(
      'AEGIS onboarding\nowner: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8\nbank: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC\nchainId: 84532\nissuedAt: 2026-10-15T12:00:00.000Z',
    )
  })

  it('recovers to the owner after personal_sign', async () => {
    const acct = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123')
    const message = onboardingMessage(acct.address, bank, 84532, at)
    const signature = await acct.signMessage({ message })
    expect(await recoverMessageAddress({ message, signature })).toBe(acct.address)
  })
})

describe('activation message', () => {
  it('is the v1 session message with role owner', () => {
    expect(sessionMessage('owner', owner, 84532, at)).toBe(
      'AEGIS session\nrole: owner\naddress: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8\nchainId: 84532\nissuedAt: 2026-10-15T12:00:00.000Z',
    )
  })
})
