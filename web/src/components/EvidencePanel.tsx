import { EVIDENCE_META, EVIDENCE_SCENARIOS } from '../replay/evidence'
import { shortHex, stamp } from '../lib/format'
import { BASESCAN_TX, CONTRACT_SUITE, REFUSALS, SCHEDULED_SCENARIOS, scheduledAfter } from '../lib/proof'
import { Chip, ErrorTag, Section } from './bits'

export function EvidencePanel() {
  const after = scheduledAfter()
  return (
    <Section id="evidence" title={`Recorded on ${EVIDENCE_META.network}`}
      info={<>Every transaction here is real and was checked against its receipt (exported {stamp(Date.parse(EVIDENCE_META.generatedAt) / 1000)}).{' '}
        {SCHEDULED_SCENARIOS.length ? `Scheduled scenarios${after ? ` run after ${after}` : ''}; until then the ${CONTRACT_SUITE.count} Foundry tests in ${CONTRACT_SUITE.path} prove those refusals.` : ''}</>}>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Recorded evidence table, scrolls sideways on small screens">
        <table className="table evidence-table">
          <thead><tr><th scope="col">Scenario</th><th scope="col">What</th><th scope="col">Status</th><th scope="col">Transactions</th></tr></thead>
          <tbody>
            {EVIDENCE_SCENARIOS.map((s) => {
              const test = REFUSALS.find((r) => r.scenario === s.id)?.test
              return (
                <tr key={s.id} id={`evidence-${s.id}`}>
                  <td className="ev-id">{s.id}</td>
                  <td className="ev-desc">{s.description}</td>
                  <td><Chip state={s.status === 'recorded' ? 'CONFIRMED' : 'HELD'}>{s.status === 'recorded' ? 'Recorded' : 'Scheduled'}</Chip></td>
                  <td>
                    {s.txs.length ? (
                      <ul className="ev-txs">
                        {s.txs.map((t) => (
                          <li key={t.hash}>
                            <a className="link-plain" href={BASESCAN_TX + t.hash} target="_blank" rel="noreferrer" title={t.label}><code>{shortHex(t.hash, 8, 6)}</code><span className="sr-only">, {t.label} on Basescan</span></a>
                            {t.reverted ? <ErrorTag name={t.error} short={false} /> : null}
                          </li>
                        ))}
                      </ul>
                    ) : s.status === 'recorded' ? <span className="muted">Held, nothing to send</span>
                      : <span className="muted">{test ? `Contract test ${test}` : 'Not yet'}{s.expectedError ? <>, expects <ErrorTag name={s.expectedError} short={false} /></> : null}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
