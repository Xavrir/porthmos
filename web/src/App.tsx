import { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell, MarketBanner, Notices, usePageTitle } from './components/chrome'
import { SeatChooser } from './components/SeatChooser'
import { Loading } from './components/bits'
import { Landing } from './pages/Landing'
import { useGate } from './auth/hooks'
import { installRouteFade } from './lib/ghost'

const Treasury = lazy(() => import('./pages/Treasury'))
const Copilot = lazy(() => import('./pages/Copilot'))
const Risk = lazy(() => import('./pages/Risk'))
const Audit = lazy(() => import('./pages/Audit'))
const Bank = lazy(() => import('./pages/Bank'))
const SignIn = lazy(() => import('./pages/SignIn'))
const SignUp = lazy(() => import('./pages/SignUp'))
const Orders = lazy(() => import('./pages/Orders'))
const Order = lazy(() => import('./pages/Order'))

const pageLoading = <main id="main" className="page"><div className="page-body"><Loading what="the page" rows={4} /></div></main>

function AppLayout({ waiting = false }: { waiting?: boolean }) {
  useEffect(() => installRouteFade(), [])
  return (
    <AppShell>
      <MarketBanner />
      {waiting ? pageLoading : (
        <Suspense fallback={pageLoading}>
          <Outlet />
        </Suspense>
      )}
    </AppShell>
  )
}

function RequireSession() {
  const gate = useGate()
  const { pathname, search, hash } = useLocation()
  if (gate === 'signin') {
    // Sign out moves the browser URL before React renders the new route; redirecting from this stale route would record it as the return path.
    if (window.location.pathname !== pathname) return null
    return <Navigate to="/signin" replace state={{ from: pathname + search + hash }} />
  }
  return <AppLayout waiting={gate === 'wait'} />
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
        <Route path="/signin" element={<Suspense fallback={null}><SignIn /></Suspense>} />
        <Route path="/signup" element={<Suspense fallback={null}><SignUp /></Suspense>} />
        <Route path="/start" element={<Navigate to="/signup" replace />} />
        <Route element={<RequireSession />}>
          <Route path="/treasury" element={<Treasury />} />
          <Route path="/copilot" element={<Copilot />} />
          <Route path="/risk" element={<Risk />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/bank" element={<Bank />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<Order />} />
        </Route>
        <Route element={<AppLayout />}>
          <Route path="/o/:id" element={<Order />} />
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
          <p>This address is not part of Porthmos.</p>
          <Link to="/treasury" className="button">Go to the treasury</Link>
        </section>
      </div>
    </main>
  )
}
