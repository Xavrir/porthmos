import { useEffect, useState } from 'react'

type Chapter = { id: string; name: string; ink: string }

export function ChapterRail() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [active, setActive] = useState<number>(-1)

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('main.landing [data-chapter]'))
    setChapters(els.map((el) => ({ id: el.id, name: el.dataset.chapter ?? '', ink: el.dataset.ink ?? '#0a0a0a' })))
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(els.indexOf(e.target as HTMLElement))
    }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 })
    els.forEach((el) => io.observe(el))
    const hero = document.querySelector('main.landing .hero')
    const heroIo = hero ? new IntersectionObserver(([e]) => { if (e.isIntersecting) setActive(-1) }, { rootMargin: '-50% 0px -50% 0px' }) : null
    if (hero && heroIo) heroIo.observe(hero)
    return () => { io.disconnect(); heroIo?.disconnect() }
  }, [])

  const on = active >= 0
  const ink = on ? chapters[active]?.ink : undefined
  return (
    <div className={`chapter-rail${on ? ' is-on' : ''}`} aria-hidden="true" inert={!on} style={ink ? { ['--rail-ink' as string]: ink } : undefined}>
      <ol>
        {chapters.map((c, i) => (
          <li key={c.id}>
            <a href={`#${c.id}`} tabIndex={-1} title={c.name} className={i === active ? 'is-active' : undefined}>
              <span className="sr-only">{c.name}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}
