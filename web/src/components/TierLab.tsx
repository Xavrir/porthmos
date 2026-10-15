import { useId, useMemo, useState } from 'react'
import { useOracle, useTreasury } from '../lib/queries'
import { previewDeposit } from '../lib/policy'
import { money, num } from '../lib/format'
import { ERRORS } from '../lib/vocabulary'

const MAX = 6000

export function TierLab() {
  const id = useId()
  const t = useTreasury()
  const o = useOracle()
  const [value, setValue] = useState(1250)
  const vault = t.data?.balances.vaults[0]
  const p = useMemo(() => (t.data && vault ? previewDeposit(t.data, o.data, vault.address, value) : null), [t.data, o.data, vault, value])

  const autoCap = t.data ? num(t.data.policy.autoCap) : 1000
  const bankLimit = t.data ? num(t.data.policy.bankLimit) : 3000
  const floorRoom = t.data ? Math.max(0, num(t.data.balances.safeUsdc) - num(t.data.reserve.onchainFloor)) : 1300

  const figure = !p || value <= 0 ? 'T0' : `T${p.tier}`
  const unit = !p || value <= 0 ? 'nothing to sign' : p.stopsAt ? 'reverts' : p.tier === 4 ? 'owner and bank sign' : p.tier === 3 ? 'owner signs' : 'agent alone'
  const sentence = !p
    ? 'Reading the treasury…'
    : value <= 0
      ? 'Slide to an amount. The figure is worked out from the live treasury and the policy on-chain.'
      : p.stopsAt
        ? `Tier ${p.tier} needs ${p.signers.join(', ').toLowerCase()}. Even with every signature the module reverts ${p.stopsAt}: ${ERRORS[p.stopsAt].plain.charAt(0).toLowerCase()}${ERRORS[p.stopsAt].plain.slice(1)} The Safe would keep ${money(p.safeAfter)} against a ${money(p.floor)} floor.`
        : p.tier === 2
          ? `Up to the ${money(autoCap)} auto cap, into a vault used before, the authorizer signs alone. The Safe keeps ${money(p.safeAfter)}, above the ${money(p.floor)} floor.`
          : p.tier === 3
            ? `Above the ${money(autoCap)} auto cap the owner must sign an approval first. The Safe keeps ${money(p.safeAfter)}, above the ${money(p.floor)} floor.`
            : `Above the ${money(bankLimit)} bank limit the bank must sign as well as the owner.`

  return (
    <div className="tierlab">
      <div className="tl-control" data-ui>
        <label htmlFor={id} className="tl-label">
          <span>Deposit into {vault?.name ?? 'Vault A'}</span>
          <output htmlFor={id} className="tl-value nums">{money(value)} USDC</output>
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={MAX}
          step={50}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          aria-describedby={`${id}-why`}
          aria-valuetext={`${money(value)} USDC, tier ${p?.tier ?? 0}${p?.stopsAt ? `, reverts ${p.stopsAt}` : ''}`}
        />
        <div className="tl-ticks" aria-hidden="true">
          <span style={{ left: `${(autoCap / MAX) * 100}%` }}>Auto cap {money(autoCap).replace('.00', '')}</span>
          <span style={{ left: `${(floorRoom / MAX) * 100}%` }} className="is-floor">Floor room {money(floorRoom).replace(/\.\d\d$/, '')}</span>
          <span style={{ left: `${(bankLimit / MAX) * 100}%` }}>Bank limit {money(bankLimit).replace('.00', '')}</span>
        </div>
      </div>
      <div className="tl-result">
        <p className={`tl-figure nums${p?.stopsAt ? ' is-stop' : ''}`} aria-live="polite">
          {figure}
          <span className="tl-unit">{unit}</span>
        </p>
        <p className="tl-why" id={`${id}-why`}>{sentence}</p>
      </div>
    </div>
  )
}
