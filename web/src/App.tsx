import { lazy, Suspense, useEffect } from 'react'
import { Link, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell, MarketBanner, ModeBanner, Notices, usePageTitle } from './components/chrome'
import { SeatChooser } from './components/SeatChooser'
import { Loading } from './components/bits'
import { Landing } from './pages/Landing'

const Treasury = lazy(() => import('./pages/Treasury'))
const Copilot = lazy(() => import('./pages/Copilot'))
const Risk = lazy(() => import('./pages/Risk'))
const Audit = lazy(() => import('./pages/Audit'))
const Bank = lazy(() => import('./pages/Bank'))
const Start = lazy(() => import('./pages/Start'))

function AppLayout() {
  const { pathname } = useLocation()
  return (
    <AppShell>
      <MarketBanner />
      {pathname === '/start' ? null : <ModeBanner />}
      <Suspense fallback={<main id="main" className="page"><div className="page-body"><Loading what="the page" rows={4} /></div></main>}>
        <Outlet />
      </Suspense>
    </AppShell>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <SeatChooser />
      <Routes>
        <Route path="/" element={<><a className="skip" href="#main">Skip to content</a><Landing /><Notices /></>} />
        <Route element={<AppLayout />}>
          <Route path="/treasury" element={<Treasury />} />
          <Route path="/copilot" element={<Copilot />} />
          <Route path="/risk" element={<Risk />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/bank" element={<Bank />} />
          <Route path="/start" element={<Start />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  )
}

function NotFound() {
  usePageTitle('Page not found')
  return (
    <main id="main" className="page">
      <div className="page-body">
        <section className="gate-block">
          <h1>No such page</h1>
          <p>This address is not part of Porthmos. Use the page list, or go back to the overview.</p>
          <Link to="/treasury" className="button">Go to the treasury</Link>
        </section>
      </div>
    </main>
  )
}
