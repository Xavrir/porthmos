import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/contract'
import { plainError } from './errors'

describe('onboarding errors', () => {
  it('tells a failed faucet transfer apart from an empty faucet', () => {
    const failed = plainError(new ApiError('faucet', 503, { error: 'FaucetTransferFailed', detail: 'ConnectError', sent: [] }))
    expect(failed.code).toBe('FaucetTransferFailed')
    expect(failed.retry).toBe(true)
    expect(failed.message).not.toMatch(/empty for today/)
    expect(plainError(new ApiError('faucet', 503, { error: 'FaucetEmpty' })).message).toMatch(/empty for today/)
  })

  it('names an unset reserve floor among the activation failures', () => {
    const e = plainError(new ApiError('state', 409, { error: 'BadOnboardingState', failed: ['ReserveFloorNotSet'] }))
    expect(e.message).toContain('the reserve floor is not set yet')
  })
})
