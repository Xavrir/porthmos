import { lazy, Suspense, useEffect } from 'react'
import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppHeader, Notices, usePageTitle } from './components/chrome'
import { SeatChooser } from './components/SeatChooser'
import { Landing } from './pages/Landing'

const Treasury = lazy(() => import('./pages/Treasury'))
const Copilot = lazy(() => import('./pages/Copilot'))
const Risk = lazy(() => import('./pages/Risk'))
const Audit = lazy(() => import('./pages/Audit'))
const Bank = lazy(() => import('./pages/Bank'))

function AppLayout() {
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <AppHeader />
      <Suspense fallback={<main id="main" className="page"><p className="empty wrap">Loading the page…</p></main>}>
        <Outlet />
      </Suspense>
      <Notices />
    </div>
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
      <section className="page-band c-black on-dark"><div className="wrap"><h1>No such page</h1><p>This address is not part of AEGIS. Use the pages above, or go back to the overview.</p></div></section>
    </main>
  )
}
