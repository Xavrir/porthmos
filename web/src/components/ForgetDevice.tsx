import { useId, useState } from 'react'
import { useSignOut } from '../auth/hooks'
import { FORGET_WORD, forgetConfirmed } from '../lib/auth'
import { shortHex } from '../lib/format'
import { ownerAddress } from '../lib/keys'
import { downloadRecovery } from '../lib/recovery'
import { useAegis } from '../lib/source'
import { Dialog } from './Dialog'

export function ForgetDevice({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallet, setWallet, refresh } = useAegis()
  const signOut = useSignOut()
  const [typed, setTyped] = useState('')
  const [saved, setSaved] = useState(false)
  const id = useId()
  const close = () => { setTyped(''); onClose() }
  const forget = () => {
    if (!forgetConfirmed(typed)) return
    setTyped('')
    onClose()
    signOut()
    setWallet(null)
    refresh(null)
  }
  return (
    <Dialog open={open && !!wallet} onClose={close} labelledBy={id} className="dialog-forget">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id={id}>Forget this device</h2>
          <button type="button" className="button small quiet" onClick={close}>Close</button>
        </div>
        <p>This signs you out and removes both keys of owner <code>{wallet ? shortHex(ownerAddress(wallet)) : ''}</code> from this browser. The treasury itself stays on-chain.</p>
        <div className="keys-warning">
          <p><strong>Download your recovery file first.</strong> Without it, no browser can open this treasury again.</p>
        </div>
        <div className="row-actions">
          <button type="button" id="forget-download" className="button secondary" onClick={() => { if (wallet) { downloadRecovery(wallet); setSaved(true) } }}>{saved ? 'Download it again' : 'Download recovery file'}</button>
        </div>
        <form className="forget-form" onSubmit={(e) => { e.preventDefault(); forget() }}>
          <label htmlFor="forget-typed">Type {FORGET_WORD} to confirm</label>
          <input id="forget-typed" className="field" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
          <div className="row-actions">
            <button type="submit" id="forget-confirm" className="button danger" disabled={!forgetConfirmed(typed)}>Forget this device</button>
            <button type="button" className="button quiet" onClick={close}>Cancel</button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}
