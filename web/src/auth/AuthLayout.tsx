import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { prefersStill } from '../landing/canvas'
import { startSea } from './sea'

function useAuthTheme() {
  useLayoutEffect(() => {
    const root = document.documentElement
    const before = root.dataset.theme
    root.classList.add('app-theme', 'auth-theme')
    root.dataset.theme = 'dark'
    return () => {
      root.classList.remove('auth-theme', 'app-theme')
      if (before) root.dataset.theme = before
      else delete root.dataset.theme
    }
  }, [])
}

function Sea() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const loop = startSea(canvas, { still: prefersStill() })
    return () => loop.stop()
  }, [])
  return <canvas ref={ref} className="auth-sea" />
}

export function AuthLayout({ title, lede, children, footer }: { title: string; lede?: ReactNode; children: ReactNode; footer: ReactNode }) {
  useAuthTheme()
  return (
    <div className="auth">
      <a className="skip" href="#main">Skip to content</a>
      <div className="auth-art" aria-hidden="true"><Sea /></div>
      <main id="main" className="auth-main">
        <div className="auth-col">
          <Link to="/" className="auth-brand" aria-label="Porthmos, home">
            <img src="/brand/porthmos-mark.png" width={22} height={24} alt="" />
            <span>Porthmos</span>
          </Link>
          <h1 className="auth-title">{title}</h1>
          {lede ? <p className="auth-lede">{lede}</p> : null}
          {children}
          <p className="auth-foot">{footer}</p>
        </div>
      </main>
    </div>
  )
}

export function OrDivider() {
  return <div className="auth-or"><span>or</span></div>
}
