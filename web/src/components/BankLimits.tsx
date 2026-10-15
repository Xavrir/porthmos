import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { useAegis } from '../lib/source'
import { useIdentity, type RegistryFn } from '../lib/identity'
import { REGISTRY_ABI } from '../lib/deployment'
import { publicClientFor } from '../lib/onboard/chain'
import { plainError } from '../lib/onboard/errors'
import { fromUnits, money, toUnits } from '../lib/format'
import { SignConfirm } from './SignConfirm'
import { TxStatus } from './TxStatus'

type Pending = { fn: RegistryFn; args: readonly unknown[]; summary: string }

const CAPS: { fn: RegistryFn; read: 'autoCap' | 'dailyCap' | 'maxBandWidth'; name: string; what: string; decimals: number }[] = [
  { fn: 'setAutoCap', read: 'autoCap', name: 'Auto cap', what: 'Largest deposit the agent may make alone.', decimals: 6 },
  { fn: 'setDailyCap', read: 'dailyCap', name: 'Daily cap', what: 'Most the agent may deposit in one UTC day.', decimals: 6 },
  { fn: 'setMaxBandWidth', read: 'maxBandWidth', name: 'Price band', what: 'Widest price band a record may be signed for.', decimals: 8 },
]

function show(v: bigint, decimals: number) {
  return decimals === 8 ? fromUnits(v, 8).toFixed(4) : money(fromUnits(v))
}

export function BankLimits({ safe }: { safe: Address }) {
  const { chainId, rpcUrl, deployment } = useAegis()
  const { sendAs, localAddress } = useIdentity()
  const qc = useQueryClient()
  const bankKey = localAddress('bank')
  const [pending, setPending] = useState<Pending | null>(null)
  const [sent, setSent] = useState<{ hash: Hex; summary: string } | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [invalid, setInvalid] = useState<string | null>(null)

  const vaults = [{ address: deployment.vaultA, name: 'Vault A' }, { address: deployment.vaultB, name: 'Vault B' }]
  const limits = useQuery({
    queryKey: ['bank-limits', chainId, safe, sent?.hash],
    queryFn: async () => {
      const c = publicClientFor(chainId, rpcUrl)
      const r = (functionName: string, args: unknown[]) => c.readContract({ address: deployment.registry, abi: REGISTRY_ABI, functionName, args } as never) as Promise<unknown>
      const [autoCap, dailyCap, maxBandWidth, a, b] = await Promise.all([
        r('autoCap', [safe]), r('dailyCap', [safe]), r('maxBandWidth', [safe]), r('allowedVault', [safe, vaults[0].address]), r('allowedVault', [safe, vaults[1].address]),
      ])
      return { autoCap: autoCap as bigint, dailyCap: dailyCap as bigint, maxBandWidth: maxBandWidth as bigint, allowed: [a as boolean, b as boolean] }
    },
    refetchInterval: 20000,
  })

  const send = useMutation({
    mutationFn: (p: Pending) => sendAs('bank', p.fn, p.args),
    onSuccess: (hash, p) => { setSent({ hash, summary: p.summary }); setPending(null) },
  })

  const ask = (p: Pending) => { setInvalid(null); send.reset(); setPending(p) }
  const lower = (cap: (typeof CAPS)[number]) => {
    const cur = limits.data?.[cap.read]
    const text = (values[cap.fn] ?? '').trim()
    if (cur === undefined || !/^\d+(\.\d+)?$/.test(text)) { setInvalid(`Enter a number for the ${cap.name.toLowerCase()}.`); return }
    const v = cap.decimals === 8 ? BigInt(Math.round(Number(text) * 1e8)) : toUnits(Number(text))
    if (v >= cur) { setInvalid(`The bank can only lower the ${cap.name.toLowerCase()}. It is ${show(cur, cap.decimals)} now.`); return }
    ask({ fn: cap.fn, args: [safe, v], summary: `${cap.name} lowered to ${show(v, cap.decimals)}` })
  }

  if (!bankKey) return null
  return (
    <section className="block" aria-labelledby="limits-title">
      <div className="block-head">
        <h2 id="limits-title">Tighten this client’s limits</h2>
        <p>Your bank key sends these straight to the PolicyRegistry. The registry lets the bank only lower a cap or remove a vault, never loosen or add. Exits still run.</p>
      </div>
      <div className="limits">
        {vaults.map((v, i) => (
          <div key={v.address} className="limit">
            <h3>{v.name}</h3>
            <p className="muted">{limits.data ? (limits.data.allowed[i] ? 'Allowed for deposits.' : 'Removed. The agent cannot deposit here; it can still exit.') : 'Reading the chain…'}</p>
            <button type="button" className="button small secondary" disabled={!limits.data?.allowed[i] || send.isPending}
              onClick={() => ask({ fn: 'removeVault', args: [safe, v.address], summary: `${v.name} removed from the allowlist` })}>Remove {v.name}</button>
          </div>
        ))}
        {CAPS.map((cap) => (
          <div key={cap.fn} className="limit">
            <h3>{cap.name}</h3>
            <p className="muted">{cap.what} Now <span className="nums">{limits.data ? show(limits.data[cap.read], cap.decimals) : '…'}</span>.</p>
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); lower(cap) }}>
              <label>New, lower value<input className="field nums" inputMode="decimal" value={values[cap.fn] ?? ''} onChange={(e) => setValues({ ...values, [cap.fn]: e.target.value })} placeholder={cap.decimals === 8 ? '0.0100' : '500.00'} /></label>
              <button type="submit" className="button small navy" disabled={send.isPending}>Lower</button>
            </form>
          </div>
        ))}
      </div>
      {invalid ? <p className="error-note" role="alert">{invalid}</p> : null}
      {pending ? (
        <SignConfirm role="bank" address={bankKey} what="a transaction" confirmLabel="Sign and send" busy={send.isPending} onConfirm={() => send.mutate(pending)} onCancel={() => setPending(null)}>
          <p><code>{pending.fn}</code> on the PolicyRegistry: {pending.summary}. It raises the policy version, so records signed before it stop working.</p>
        </SignConfirm>
      ) : null}
      {send.error ? <p className="error-note" role="alert">{plainError(send.error, 'The bank key').message}</p> : null}
      <div role="status">
        {sent ? <p className="ok-note">{sent.summary}. Sent: <TxStatus hash={sent.hash} label="bank transaction" onMined={() => { qc.invalidateQueries({ queryKey: ['bank-clients'] }); qc.invalidateQueries({ queryKey: ['treasury'] }); void limits.refetch() }} /></p> : null}
      </div>
    </section>
  )
}
