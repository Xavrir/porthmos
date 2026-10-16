import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from 'viem'
import { ApiError } from '../api/contract'
import { ERRORS, isErrorName } from '../vocabulary'
import { ReceiptTimeout } from './chain'

export type Plain = { code: string; message: string; retry: boolean }

const API_CODES: Record<string, Omit<Plain, 'code'>> = {
  RateLimited: { message: 'Too many requests from this network for now. Wait a little and try again; finished steps are kept.', retry: true },
  OnboardingClosed: { message: 'New treasuries are closed for now: the test network limit is reached. You can still look at the recorded run.', retry: false },
  FaucetEmpty: { message: 'The test ETH faucet is empty for today. Try again after midnight UTC, or send a little Base Sepolia ETH to the owner and bank keys.', retry: true },
  NotActivated: { message: 'This treasury is not active yet. Finish the setup on the Create page.', retry: true },
  BadOnboardingState: { message: 'The server read the chain and found a step not done yet. Retry: it checks again and skips what is finished.', retry: true },
  StaleSignature: { message: 'The signed message is too old. Retry to sign a fresh one.', retry: true },
  BadSignature: { message: 'The server could not match the signature to the key. Retry; if it fails again, import the key file you saved.', retry: true },
  NotAnOwner: { message: 'The server does not know this key as the owner of a treasury yet.', retry: true },
  NotABank: { message: 'The server does not know this key as the bank of a treasury yet.', retry: true },
  SessionRequired: { message: 'Your session ended. Choose your seat again to sign in.', retry: true },
  AttackerUnavailable: { message: 'The attacker key on the server is busy or out of gas. Try again in a minute.', retry: true },
  UnknownAttack: { message: 'The server does not know this attack.', retry: false },
  ActivationInProgress: { message: 'The server is already activating this treasury. Wait a few seconds and retry.', retry: true },
  OwnerHasTreasury: { message: 'This owner key already has a treasury. Import that key file instead.', retry: false },
  NothingToReplay: { message: 'Nothing to replay yet: this treasury has no executed record. Let the agent make one deposit, then try again.', retry: false },
}

function first(text: string): string {
  return text.split('\n')[0].replace(/\.$/, '')
}

const FAILED: Record<string, string> = {
  SafeNotDeployed: 'the Safe is not created yet',
  ThresholdNotOne: 'the Safe must need one signature',
  OwnerNotOnSafe: 'the owner key is not an owner of the Safe',
  ModuleNotEnabled: 'the Porthmos module is not on',
  RegistryOwnerMismatch: 'the registry lists a different owner',
  BadBank: 'the bank key is missing or equals the owner',
  WrongAuthorizer: 'the authorizer is not the Porthmos key',
  WrongExitKey: 'the exit key is not the Porthmos key',
  AutoCapOutOfBounds: 'the auto cap is outside the allowed range',
  DailyCapOutOfBounds: 'the daily cap is outside the allowed range',
  MaxBandWidthOutOfBounds: 'the price band is outside the allowed range',
  MaxOracleAgeOutOfBounds: 'the price age limit is outside the allowed range',
  BankLimitOutOfBounds: 'the bank limit is outside the allowed range',
  UnexpectedSafeAddress: 'the Safe is not at the address made from your owner key',
  OwnerHasTreasury: 'this owner key already has a treasury',
  ActivationInProgress: 'activation is already running',
}

function failedText(body: unknown): string {
  const f = (body as { failed?: unknown } | undefined)?.failed
  if (!Array.isArray(f) || !f.length) return ''
  const words = f.map((x) => {
    const code = String(x)
    if (code.startsWith('VaultMissing:')) return `${code.slice(13)} is not allowed yet`
    return FAILED[code] ?? code
  })
  return ` Not done yet: ${words.join('; ')}.`
}

export function plainError(e: unknown, who = 'This key'): Plain {
  if (e instanceof ApiError) {
    if (e.code === 'BadOnboardingState') {
      const f = failedText(e.body)
      return { code: e.code, message: `The server read the chain and found a step not done yet.${f} Retry: it checks again and skips what is finished.`, retry: true }
    }
    const known = API_CODES[e.code ?? '']
    if (known) return { code: e.code!, ...known }
    if (e.status === 429) return { code: 'RateLimited', ...API_CODES.RateLimited }
    if (e.status === 0 || e.status >= 500) return { code: 'ServiceDown', message: 'The Porthmos service did not answer. Try again in a moment.', retry: true }
    return { code: e.code ?? `HTTP${e.status}`, message: `${first(e.message)}.`, retry: true }
  }
  if (e instanceof ReceiptTimeout) return { code: 'Slow', message: 'The network is slow to confirm. Retry: it checks the chain first, so nothing is sent twice.', retry: true }
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return { code: 'Rejected', message: 'You declined in your wallet. Nothing was sent.', retry: true }
    if (e.walk((x) => x instanceof InsufficientFundsError) || /insufficient funds/i.test(e.message)) {
      return { code: 'OutOfGas', message: `${who} has run out of test ETH for gas. Retry to ask the faucet again, or send a little Base Sepolia ETH to it.`, retry: true }
    }
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    const name = reverted?.data?.errorName ?? reverted?.reason
    if (name) {
      const plain = isErrorName(name) ? ERRORS[name].plain : name === 'Unauthorized' ? 'The key that sent it does not hold the role this call needs.' : ''
      return { code: name, message: `The contract refused it with ${name}. ${plain}`.trim(), retry: true }
    }
    if (/fetch|network|timed? ?out|HTTP request failed/i.test(e.message)) return { code: 'Network', message: 'Could not reach the network. Check the connection and retry.', retry: true }
    return { code: 'Chain', message: `${first(e.shortMessage || e.message)}.`, retry: true }
  }
  if (e instanceof TypeError && /fetch/i.test(e.message)) return { code: 'Network', message: 'Could not reach the Porthmos service. Check the connection and retry.', retry: true }
  return { code: 'Error', message: e instanceof Error ? `${first(e.message)}.` : 'Something went wrong. Retry.', retry: true }
}
