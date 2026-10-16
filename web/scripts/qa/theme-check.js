// Playwright CLI run-code snippet: every app route paints html, body, the mount node and <main> with the theme's --bg token,
// in light and dark, even with a host stylesheet that colours #root (the production bug: rgb(20, 25, 36)).
async (page) => {
  const BASE = '__BASE__'
  const routes = ['/treasury', '/copilot', '/risk', '/audit', '/bank', '/start']
  const failures = []
  const results = []
  for (const theme of ['light', 'dark']) {
    for (const route of routes) {
      await page.goto(BASE + '/')
      await page.evaluate((t) => { localStorage.setItem('porthmos.theme', t); sessionStorage.setItem('aegis.seat', 'owner') }, theme)
      await page.goto(BASE + route)
      await page.waitForSelector('main#main')
      await page.addStyleTag({ content: '#root { background-color: rgb(20, 25, 36) !important; }' })
      const r = await page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg')
        document.body.appendChild(probe)
        const token = getComputedStyle(probe).backgroundColor
        probe.remove()
        const bg = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : 'missing' }
        return { theme: document.documentElement.dataset.theme, appTheme: document.documentElement.classList.contains('app-theme'), token, html: bg('html'), body: bg('body'), mount: bg('#porthmos'), main: bg('main#main'), legacyRoot: !!document.getElementById('root') }
      })
      results.push({ theme, route, ...r })
      for (const k of ['html', 'body', 'mount', 'main']) if (r[k] !== r.token) failures.push(`${theme} ${route}: ${k} is ${r[k]}, expected ${r.token}`)
      if (r.theme !== theme || !r.appTheme) failures.push(`${theme} ${route}: html has data-theme=${r.theme}, app-theme=${r.appTheme}`)
      if (r.legacyRoot) failures.push(`${theme} ${route}: an element still has id="root"`)
    }
  }
  if (failures.length) throw new Error('Theme consistency failed:\n' + failures.join('\n'))
  return JSON.stringify({ ok: true, checked: results.length, light: results.find((x) => x.theme === 'light').token, dark: results.find((x) => x.theme === 'dark').token })
}
