import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { Hash, InfoTip, type Tone } from './bits'
import { Icon, type IconName } from './icons'
import { MILESTONE_LABEL, MILESTONE_TONE, ORDER_LABEL, ORDER_TONE, type MilestoneDisplay, type OrderDisplay } from '../lib/tradeflow/state'
import { MILESTONES, type IssuerRole } from '../lib/tradeflow/model'
import type { PinnedTradeFlow } from '../lib/txguard'

const ICON: Record<MilestoneDisplay | OrderDisplay, IconName> = {
  pending: 'clock', waiting: 'clock', releasing: 'tx', held: 'alert', released: 'check', waived: 'check', refunded: 'left',
  active: 'clock', completed: 'check',
}

export function Pill({ tone, icon, children }: { tone: Tone; icon: IconName; children: ReactNode }) {
  return <span className={`chip tone-${tone}`}><Icon name={icon} className="chip-icon" />{children}</span>
}

export function MilestonePill({ state, reason }: { state: MilestoneDisplay; reason?: string | null }) {
  return <Pill tone={MILESTONE_TONE[state]} icon={ICON[state]}><span>{MILESTONE_LABEL[state]}{state === 'held' && reason ? <span className="pill-reason">: {reason}</span> : null}</span></Pill>
}

export function OrderPill({ state }: { state: OrderDisplay }) {
  return <Pill tone={ORDER_TONE[state]} icon={ICON[state]}>{ORDER_LABEL[state]}</Pill>
}

export function HeldFlag() {
  return <Pill tone="held" icon="alert">Held</Pill>
}

export function issuerRoleOf(issuer: Address, pinned: PinnedTradeFlow | null, fallbackIndex: number): IssuerRole | null {
  if (pinned) {
    for (const r of ['carrier', 'sensor', 'surveyor'] as IssuerRole[]) if (pinned.issuers[r].toLowerCase() === issuer.toLowerCase()) return r
    return null
  }
  return MILESTONES[fallbackIndex]?.role ?? null
}

export function IssuerLabel({ issuer, index, pinned }: { issuer: Address; index: number; pinned: PinnedTradeFlow | null }) {
  const role = issuerRoleOf(issuer, pinned, index)
  const spec = role ? MILESTONES.find((m) => m.role === role) : undefined
  return (
    <span className="issuer">
      <span>{spec ? spec.issuerLabel : 'Issuer'}</span>
      {spec ? <span className="demo-tag">demo issuer</span> : null}
      <InfoTip label={`About the ${spec?.issuerLabel.toLowerCase() ?? 'issuer'}`}>
        {spec ? `${spec.standIn}. A server-held test key that signs only proofs.` : 'Not one of the bundled demo issuers.'} Address <code>{issuer}</code>.
      </InfoTip>
      <Hash value={issuer} kind="address" label="issuer address" />
    </span>
  )
}
