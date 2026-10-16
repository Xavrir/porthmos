// Playwright CLI run-code snippet: full-page screenshots of every app route at 1440 and 390, light and dark,
// with horizontal overflow and console errors recorded per shot.
async (page) => {
  const BASE = '__BASE__'
  const OUT = '__OUT__'
  const routes = [['treasury', 'owner'], ['copilot', 'owner'], ['risk', 'owner'], ['audit', 'owner'], ['bank', 'bank'], ['start', 'owner']]
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  const report = []
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width > 800 ? 900 : 844 })
    for (const theme of ['light', 'dark']) {
      for (const [route, seat] of routes) {
        errors.length = 0
        await page.goto(BASE + '/')
        await page.evaluate(([t, s]) => { localStorage.setItem('porthmos.theme', t); sessionStorage.setItem('aegis.seat', s) }, [theme, seat])
        await page.goto(BASE + '/' + route)
        await page.waitForSelector('main#main h1')
        await page.waitForTimeout(1200)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        const file = `${OUT}/${route}-${width}-${theme}.png`
        await page.screenshot({ path: file, fullPage: true })
        report.push({ route, width, theme, file, overflow, errors: [...errors] })
      }
    }
  }
  return JSON.stringify({ shots: report.length, overflow: report.filter((r) => r.overflow > 0).map((r) => `${r.route}-${r.width}-${r.theme}: ${r.overflow}px`), errors: report.filter((r) => r.errors.length).map((r) => ({ shot: `${r.route}-${r.width}-${r.theme}`, errors: r.errors })) })
}
