import { recordedSlot } from '../replay/hashes'
import { GATES, type Gate } from '../lib/vocabulary'
import { proofFor, REFUSALS } from '../lib/proof'

const BASESCAN = 'https://sepolia.basescan.org/tx/'

const FIELD: Record<Gate, string> = {
  intent: 'f-blue', plan: 'f-blue', policy: 'f-red', simulation: 'f-red', signature: 'f-navy', guard: 'f-black', execute: 'f-split',
}

function Artifact({ gate }: { gate: Gate }) {
  const e1 = recordedSlot('e1-deposit')
  const bad = proofFor(REFUSALS[0])
  switch (gate) {
    case 'intent':
      return (
        <div className="ga" data-ui>
          <p className="ga-quote">“Keep payroll safe and put the surplus to work.”</p>
          <dl className="ga-rows"><div><dt>Goal</dt><dd>Deploy surplus</dd></div><div><dt>Keep</dt><dd>The reserve for payroll and invoices</dd></div><div><dt>Keys held by the agent</dt><dd>None</dd></div></dl>
        </div>
      )
    case 'plan':
      return (
        <div className="ga" data-ui>
          <dl className="ga-rows"><div><dt>Reserve kept</dt><dd>4,500.00</dd></div><div><dt>Default option</dt><dd>Vault B 2,000.00</dd></div><div><dt>Other option</dt><dd>Hold</dd></div><div><dt>Model may pick</dt><dd>The default, or anything smaller</dd></div></dl>
        </div>
      )
    case 'policy':
      return (
        <div className="ga" data-ui>
          <ul className="ga-checks"><li><b>Pass</b> Vault B is on the owner’s list</li><li><b>Pass</b> Safe keeps 6,500.00, floor 4,500.00</li><li><b>Pass</b> 2,000.00 of the 5,000.00 daily cap</li><li><b>Tier 3</b> First deposit into Vault B: the owner signs</li></ul>
        </div>
      )
    case 'simulation':
      return (
        <div className="ga" data-ui>
          <dl className="ga-rows"><div><dt>module.check</dt><dd>ok, tier 3</dd></div><div><dt>USDC out of the Safe</dt><dd>2,000.00</dd></div><div><dt>Shares into the Safe</dt><dd>2,000.00</dd></div><div><dt>Approval after</dt><dd>reset to 0</dd></div></dl>
        </div>
      )
    case 'signature':
      return (
        <div className="ga" data-ui>
          <dl className="ga-rows"><div><dt>Owner approval</dt><dd>EIP-712, up to 2,000.00, 24 h</dd></div><div><dt>Authorizer record</dt><dd>EIP-712 DAR, expires in 120 s</dd></div><div><dt>Binds</dt><dd>Policy v11, price band, nonce, approval hash</dd></div></dl>
        </div>
      )
    case 'guard':
      return (
        <div className="ga" data-ui>
          <ul className="ga-checks"><li><b>Holds</b> Signer is the registered authorizer</li><li><b>Holds</b> Nonce unused, record unexpired</li><li><b>Holds</b> Price 1.0000 inside the signed band</li><li><b>Holds</b> Floor and daily cap, measured again</li></ul>
        </div>
      )
    case 'execute':
      return (
        <div className="ga-split">
          <div className="ga-half ga-exec" data-ui>
            <p className="ga-verdict">Execute</p>
            <p>2,000.00 USDC into Vault B, 2,000.00 shares back to the Safe.</p>
            {e1 ? <a className="link-plain" href={BASESCAN + e1.hash} target="_blank" rel="noreferrer">AegisExecuted, block {e1.block.toLocaleString('en-US')} on Base Sepolia</a> : <p>AegisExecuted</p>}
          </div>
          <div className="ga-half ga-reject" data-ui>
            <p className="ga-verdict">Reject</p>
            <p>The same record with its amount edited to 4,000.00 after signing.</p>
            <p className="ga-error"><code>BadSignature</code></p>
            {bad.kind === 'onchain' ? <a className="link-plain" href={bad.href} target="_blank" rel="noreferrer">Reverted on Base Sepolia, block {bad.block.toLocaleString('en-US')}</a> : <p>Contract test {REFUSALS[0].test}; the Base Sepolia run is scheduled.</p>}
          </div>
        </div>
      )
  }
}

export function Gates() {
  return (
    <section className="ch gates7" id="gates" data-chapter="Seven gates" data-ink="#ffffff" data-gate="intent" aria-labelledby="gates-title">
      <div className="g7-top wrap">
        <h2 id="gates-title" className="g7-title">Every action passes seven gates</h2>
        <ol className="g7-rail" aria-hidden="true">
          {GATES.map((g) => <li key={g.id} className="g7-step" data-step={g.id}>{g.name}</li>)}
          <li className="g7-fill" />
        </ol>
      </div>
      <div className="g7-fields" aria-hidden="true">
        {GATES.map((g) => <div key={g.id} className={`g7-field ${FIELD[g.id]}`} data-gate={g.id} />)}
      </div>
      <ol className="g7-panels">
        {GATES.map((g) => (
          <li key={g.id} className={`gate-panel ${FIELD[g.id]}`} data-gate={g.id}>
            <div className="gp-inner wrap">
              <div className="gp-text">
                <h3 className="gp-name">{g.name}</h3>
                <p className="gp-who">{g.who}</p>
                <p className="gp-detail">{g.detail}</p>
              </div>
              <div className="gp-art">
                <Artifact gate={g.id} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
