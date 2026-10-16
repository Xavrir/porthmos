// Playwright CLI run-code snippet: axe-core on /treasury, /bank and /audit with a row drawer open, at 1440 and 390, light and dark.
// AXE_PATH must point at axe.min.js (axe-core 4.x).
async (page) => {
  const BASE = '__BASE__'
  const AXE = '__AXE__'
  const targets = [['treasury', 'owner', null], ['bank', 'bank', null], ['audit', 'owner', '#row-20']]
  const out = []
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width > 800 ? 900 : 844 })
    for (const theme of ['light', 'dark']) {
      for (const [route, seat, hash] of targets) {
        await page.goto(BASE + '/')
        await page.evaluate(([t, s]) => { localStorage.setItem('porthmos.theme', t); sessionStorage.setItem('aegis.seat', s) }, [theme, seat])
        await page.goto(BASE + '/' + route + (hash ?? ''))
        await page.waitForSelector('main#main h1')
        await page.waitForTimeout(1200)
        if (hash) await page.waitForSelector('dialog.drawer[open]')
        await page.addScriptTag({ path: AXE })
        const res = await page.evaluate(async () => {
          const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
          return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + n.failureSummary.split('\n').slice(0, 2).join(' ')) }))
        })
        out.push({ shot: `${route}${hash ? '+drawer' : ''}-${width}-${theme}`, violations: res })
      }
    }
  }
  const bad = out.filter((o) => o.violations.length)
  return JSON.stringify({ runs: out.length, clean: out.length - bad.length, bad }, null, 1)
}
