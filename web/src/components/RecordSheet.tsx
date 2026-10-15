import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { onTick, reducedMotion } from './Count'
import type { Address } from 'viem'
import { DAR_FIELD_NOTES, recoverSigner, typedDataFor } from '../lib/eip712'
import { fromUnits, money, shortHex, stamp } from '../lib/format'
import type { SignedRecord } from '../lib/types'

type Props = {
  record: SignedRecord
  chainId: number
  module: Address
  expected?: { address: Address; label: string }
  names?: Record<string, string>
  changed?: Record<string, string>
  showNotes?: boolean
  illustrative?: boolean
}

export function formatField(key: string, value: string | number, names: Record<string, string> = {}): string {
  const v = String(value)
  switch (key) {
    case 'op': return Number(v) === 0 ? '0 (DEPOSIT)' : '1 (REDEEM)'
    case 'tier': return `${v} (T${v})`
    case 'amount': case 'minOut': case 'maxAmount': return `${money(fromUnits(v))}`
    case 'priceLow': case 'priceHigh': return Number(v) === 0 ? '0 (not checked on redeem)' : fromUnits(v, 8).toFixed(8)
    case 'expiry': case 'approvalExpiry': return stamp(Number(v))
    case 'policyVersion': return `v${v}`
    case 'nonce': case 'approvalNonce': return shortHex('0x' + BigInt(v).toString(16).padStart(64, '0'), 8, 6)
    case 'safe': case 'vault': return names[v.toLowerCase()] ? `${names[v.toLowerCase()]} ${shortHex(v)}` : shortHex(v)
    case 'approvalHash': return /^0x0+$/.test(v) ? '0x0 (no approval needed)' : shortHex(v, 8, 6)
    default: return v.startsWith('0x') ? shortHex(v, 8, 6) : v
  }
}

export function expectedSigner(record: SignedRecord, mode: 'live' | 'replay', role: { address: Address; label: string }): { address: Address; label: string } | undefined {
  if (mode === 'replay') return record.signer ? { address: record.signer, label: 'key that signed it' } : undefined
  return role
}

export function RecordSheet({ record, chainId, module, expected, names, changed, showNotes = false, illustrative = false }: Props) {
  const [recovered, setRecovered] = useState<Address | null | 'pending'>('pending')
  const message = changed ? { ...record.message, ...changed } : record.message

  useEffect(() => {
    let live = true
    if (!record.signature) { setRecovered(null); return }
    setRecovered('pending')
    recoverSigner(typedDataFor({ primaryType: record.primaryType, message }, chainId, module), record.signature).then((a) => { if (live) setRecovered(a) })
    return () => { live = false }
    // message identity changes every render; its JSON is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.signature, record.primaryType, JSON.stringify(message), chainId, module])

  const matches = expected && recovered && recovered !== 'pending' ? recovered.toLowerCase() === expected.address.toLowerCase() : null
  const sheetRef = useRef<HTMLElement>(null)
  const verdictRef = useRef<HTMLSpanElement>(null)
  const recordKey = `${record.signature}-${record.primaryType}-${JSON.stringify(changed ?? {})}`

  useLayoutEffect(() => {
    const el = sheetRef.current
    if (!el || reducedMotion()) return
    const rows = el.querySelectorAll('.sheet-fields > div > *, .sheet-sig > *')
    let cancel: (() => void) | null = null
    let tween: gsap.core.Tween | null = null
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      cancel = onTick(() => { tween = gsap.fromTo(rows, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out', stagger: 0.025 }) })
    }, { threshold: 0.15 })
    io.observe(el)
    return () => { io.disconnect(); cancel?.(); tween?.kill(); gsap.set(rows, { clearProps: 'opacity,visibility,transform' }) }
  }, [recordKey])

  useLayoutEffect(() => {
    const el = verdictRef.current
    if (!el || matches !== false || reducedMotion()) return
    const call = gsap.delayedCall(0.25, () => { gsap.fromTo(el, { rotateX: -90, transformPerspective: 500, transformOrigin: '50% 100%' }, { rotateX: 0, duration: 0.55, ease: 'power3.out' }) })
    return () => { call.kill(); gsap.killTweensOf(el); gsap.set(el, { clearProps: 'transform' }) }
  }, [matches, recordKey])

  return (
    <article className="sheet" data-ui ref={sheetRef} aria-label={record.primaryType === 'DAR' ? 'Decision authorization record' : 'Owner approval'}>
      <header className="sheet-head">
        <p className="sheet-title">{record.primaryType === 'DAR' ? 'Decision Authorization Record' : 'Approval'}</p>
        <p className="sheet-sub">EIP-712, domain AegisModule v1, chain {chainId}</p>
      </header>
      <dl className="sheet-fields">
        {Object.entries(message).map(([k, v]) => (
          <div key={k} className={changed && k in changed ? 'is-changed' : undefined}>
            <dt>{k}</dt>
            <dd>
              <code>{formatField(k, v, names)}</code>
              {changed && k in changed ? <span className="sheet-flag">edited after signing</span> : null}
              {showNotes && DAR_FIELD_NOTES[k] ? <span className="sheet-note">{DAR_FIELD_NOTES[k]}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <footer className="sheet-sig">
        {record.replayUnsigned ? (
          <p>Signature: not recorded. Replay can show new records but cannot sign them; the live service signs with the authorizer key.</p>
        ) : !record.signature && record.signatureWithheld ? (
          <p>Signed by the {expected?.label ?? 'signer'}. The service does not publish this signature; the contract checked it when the transaction ran.</p>
        ) : !record.signature ? (
          <p>Unsigned. Waiting for {expected?.label ?? 'a signer'}.</p>
        ) : (
          <>
            {illustrative ? <p className="sheet-note">Illustrative signature from a public test key, over the Base Sepolia domain. Recorded signatures replace it.</p> : null}
            <p>Signature <code>{shortHex(record.signature, 10, 8)}</code></p>
            <p>
              Recovered in your browser:{' '}
              {recovered === 'pending' ? 'checking…' : <code>{recovered ? shortHex(recovered) : 'invalid'}</code>}
              {expected ? (
                <span className={`sig-verdict ${matches ? 'ok' : matches === false ? 'bad' : ''}`}>
                  {matches === null ? '' : matches ? ` matches the ${expected.label}` : ` is not the ${expected.label}`}
                </span>
              ) : null}
            </p>
            {matches === false ? <p className="sig-reject"><span ref={verdictRef} className="sig-flip">The module reverts <code>BadSignature</code></span></p> : null}
          </>
        )}
      </footer>
    </article>
  )
}
