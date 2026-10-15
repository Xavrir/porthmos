import { EVIDENCE_META, EVIDENCE_SCENARIOS } from '../replay/evidence'
import { shortHex, stamp } from '../lib/format'
import { BASESCAN_TX, CONTRACT_SUITE, REFUSALS, RECORDED_SCENARIOS, SCHEDULED_SCENARIOS, scheduledAfter } from '../lib/proof'
import { Chip, ErrorTag } from './bits'

export function EvidencePanel() {
  const after = scheduledAfter()
  return (
    <section className="block" id="evidence" aria-labelledby="evidence-title">
      <div className="block-head">
        <h2 id="evidence-title">Recorded on {EVIDENCE_META.network}</h2>
        <p>
          Every transaction below is real and was checked against its receipt (exported {stamp(Date.parse(EVIDENCE_META.generatedAt) / 1000)}).
          Recorded now: {RECORDED_SCENARIOS.join(', ')}.{' '}
          {SCHEDULED_SCENARIOS.length
            ? `Scheduled: ${SCHEDULED_SCENARIOS.join(', ')}${after ? `, which can only run after ${after}, when the 24-hour vault quarantine from E2 ends` : ''}. No reverted transaction exists for them yet. Until then the refusals are proven by the ${CONTRACT_SUITE.count} Foundry tests in ${CONTRACT_SUITE.path} (${CONTRACT_SUITE.ids}).`
            : 'Every scenario is recorded.'}
        </p>
      </div>
      <ul className="evidence">
        {EVIDENCE_SCENARIOS.map((s) => {
          const test = REFUSALS.find((r) => r.scenario === s.id)?.test
          return (
            <li key={s.id} className={`ev-${s.status}`} id={`evidence-${s.id}`}>
              <div className="ev-head">
                <span className="ev-id">{s.id}</span>
                <Chip state={s.status === 'recorded' ? 'CONFIRMED' : 'HELD'}>{s.status === 'recorded' ? 'Recorded' : 'Scheduled'}</Chip>
              </div>
              <p className="ev-desc">{s.description}</p>
              {s.txs.length ? (
                <ol className="ev-txs">
                  {s.txs.map((t) => (
                    <li key={t.hash}>
                      <span className="ev-label">{t.label}</span>
                      <a className="link-plain" href={BASESCAN_TX + t.hash} target="_blank" rel="noreferrer"><code>{shortHex(t.hash, 8, 6)}</code><span className="sr-only">, {t.label} on Basescan</span></a>
                      <span className="muted nums">block {t.block}{t.verified ? ', receipt verified' : ''}</span>
                      {t.reverted ? <span className="ev-revert">Reverted <ErrorTag name={t.error} /></span> : null}
                    </li>
                  ))}
                </ol>
              ) : s.status === 'recorded' ? (
                <p>No transaction is representable; the request was held and logged{s.requestId ? <> as <code>{s.requestId}</code></> : null} ({s.ledgerRows} ledger row{s.ledgerRows === 1 ? '' : 's'}).</p>
              ) : (
                <p>
                  Not on Base Sepolia yet{after ? `; can run after ${after}` : ''}.{' '}
                  {s.expectedError ? <>Expected to revert <ErrorTag name={s.expectedError} short={false} />. </> : null}
                  {test ? <>Proven now by contract test {test} in <code>{CONTRACT_SUITE.path}</code>.</> : null}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
