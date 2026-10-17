import { keyFileName, serializeWallet, type WalletFile } from './keys'

export function downloadRecovery(w: WalletFile) {
  const url = URL.createObjectURL(new Blob([serializeWallet(w)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = keyFileName(w)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
