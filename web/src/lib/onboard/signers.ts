import { type Address, type Hex, type PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getCapabilities, sendCalls, waitForCallsStatus } from 'viem/actions'
import { getConnectorClient, sendTransaction, signMessage, switchChain } from 'wagmi/actions'
import { wagmiConfig } from '../wallet'
import { walletClientFor } from './chain'
import type { Call, OwnerSigner, Sender } from './runner'
import type { OnboardConfig } from './types'

type ChainRef = Pick<OnboardConfig, 'chainId' | 'rpcUrl'>

const STALE_NONCE = /nonce too low|already known|replacement transaction underpriced|nonce has already been used/i

// A load-balanced RPC can report a stale pending nonce right after a receipt, so keep our own floor per key.
export function localSender(pk: Hex, chain: ChainRef, client: PublicClient): Sender & { signMessage(m: string): Promise<Hex> } {
  const account = privateKeyToAccount(pk)
  const wallet = walletClientFor(account, chain.chainId, chain.rpcUrl)
  let next: number | null = null
  const sendOnce = async (call: Call): Promise<Hex> => {
    const pending = await client.getTransactionCount({ address: account.address, blockTag: 'pending' })
    const nonce = next === null ? pending : Math.max(pending, next)
    const hash = await wallet.sendTransaction({ to: call.to, data: call.data, nonce, account, chain: wallet.chain })
    next = nonce + 1
    return hash
  }
  return {
    address: account.address,
    signMessage: (message) => account.signMessage({ message }),
    send: async (call) => {
      try {
        return await sendOnce(call)
      } catch (e) {
        if (!STALE_NONCE.test((e as Error).message ?? '')) throw e
        next = null
        return sendOnce(call)
      }
    },
  }
}

export function burnerOwner(pk: Hex, chain: ChainRef, client: PublicClient): OwnerSigner {
  return { ...localSender(pk, chain, client), kind: 'burner' }
}

async function ensureChain(chainId: number) {
  const client = await getConnectorClient(wagmiConfig)
  if (client.chain?.id !== chainId) await switchChain(wagmiConfig, { chainId: chainId as 31337 | 84532 })
}

export async function atomicBatchSupported(chainId: number, account: Address): Promise<boolean> {
  try {
    const client = await getConnectorClient(wagmiConfig, { chainId: chainId as 31337 | 84532 })
    const caps = (await getCapabilities(client, { account, chainId })) as { atomic?: { status?: string } }
    return caps?.atomic?.status === 'supported' || caps?.atomic?.status === 'ready'
  } catch {
    return false
  }
}

export async function injectedOwner(address: Address, chain: ChainRef): Promise<OwnerSigner> {
  await ensureChain(chain.chainId)
  const chainId = chain.chainId as 31337 | 84532
  const batch = await atomicBatchSupported(chain.chainId, address)
  return {
    kind: 'injected',
    address,
    signMessage: async (message) => {
      await ensureChain(chain.chainId)
      return signMessage(wagmiConfig, { account: address, message })
    },
    send: async (call) => {
      await ensureChain(chain.chainId)
      return sendTransaction(wagmiConfig, { account: address, chainId, to: call.to, data: call.data })
    },
    sendBatch: batch
      ? async (calls) => {
          await ensureChain(chain.chainId)
          const client = await getConnectorClient(wagmiConfig, { chainId })
          const { id } = await sendCalls(client, { account: address, chain: client.chain, calls: calls.map((c) => ({ to: c.to, data: c.data })), forceAtomic: true })
          const res = await waitForCallsStatus(client, { id, timeout: 180_000 })
          if (res.status !== 'success') throw new Error('The wallet reports the batch failed. Nothing changed.')
          return (res.receipts ?? []).map((r) => r.transactionHash)
        }
      : undefined,
  }
}
