import { API, Human, launch, makeWallet, signInOwner } from './lib.mjs'

// Prints the treasury figures that decide what the Copilot will propose, read with an owner session. Read-only.
const wallet = makeWallet({ maxTx: 0, clip: 'state' })
const { ctx, page } = await launch({ wallet })
try {
  await signInOwner(page, new Human(page))
  const out = await page.evaluate(async (api) => {
    let token = null
    for (let i = 0; i < sessionStorage.length; i++) {
      try { const j = JSON.parse(sessionStorage.getItem(sessionStorage.key(i))); if (j?.token) token = j.token } catch {}
    }
    const get = async (p) => (await fetch(api + p, { headers: { 'X-Aegis-Session': token } })).json()
    return { t: await get('/api/treasury'), p: await get('/api/approvals/pending') }
  }, API)
  const t = out.t
  const pending = (out.p.pending ?? out.p ?? []).map((r) => ({ id: r.requestId, state: r.state, amount: r.actionCard?.amount?.display, vault: r.actionCard?.vault?.name, tier: r.actionCard?.tier }))
  console.log(JSON.stringify({
    safe: t.balances?.safeUsdc?.display,
    vaults: (t.balances?.vaults ?? []).map((v) => `${v.name} ${v.assets?.display}`),
    depositedToday: t.policy?.depositedToday?.display, autoCap: t.policy?.autoCap?.display, dailyCap: t.policy?.dailyCap?.display,
    frozen: t.policy?.frozen, floorInSync: t.reserve?.inSync, deployable: t.deployable?.display, pending,
  }, null, 1))
} finally {
  await ctx.close()
}
