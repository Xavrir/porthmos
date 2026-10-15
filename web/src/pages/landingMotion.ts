import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, SplitText)

const EASE = 'power3.out'
const GATE_INK: Record<string, string> = {
  intent: '#ffffff', plan: '#ffffff', policy: '#0a0a0a', simulation: '#0a0a0a', signature: '#ffffff', guard: '#ffffff', execute: '#ffffff',
}

const fieldOf = (el: HTMLElement) => Array.from(el.classList).find((c) => c.startsWith('f-')) ?? ''

export function initLandingMotion(root: HTMLElement): () => void {
  const html = document.documentElement
  const q = (sel: string) => root.querySelector<HTMLElement>(sel)
  const qa = (sel: string, scope: ParentNode = root) => Array.from(scope.querySelectorAll<HTMLElement>(sel))
  const mm = gsap.matchMedia()

  mm.add({ motion: '(prefers-reduced-motion: no-preference)', wide: '(min-width: 1101px)' }, (ctx) => {
    const { motion, wide } = ctx.conditions as { motion: boolean; wide: boolean }
    if (!motion) {
      html.classList.remove('motion-pending')
      return
    }
    const undo: (() => void)[] = []
    // Every hidden start state below is applied inside the first GSAP tick, so a page whose frames never run stays fully visible.
    gsap.delayedCall(0, () => ctx.add(() => setup()))
    const setup = () => {
      const hero = () => {
        const h1 = q('.hero-head h1')
        if (h1) {
          const split = SplitText.create(h1, { type: 'lines', mask: 'lines' })
          gsap.set(split.lines, { yPercent: 108 })
          html.classList.remove('motion-pending')
          gsap.to(split.lines, { yPercent: 0, duration: 1.05, ease: 'power4.out', stagger: 0.12, delay: 0.1 })
        }
        gsap.from(qa('.hero-lede, .hero-action'), { y: 20, autoAlpha: 0, duration: 0.8, ease: EASE, stagger: 0.1, delay: 0.55 })
        const img = q('.hero-img')
        if (img) gsap.fromTo(img, { scale: 1.02, yPercent: 0 }, { scale: 1.12, yPercent: 5, ease: 'none', scrollTrigger: { trigger: q('.hero'), start: 'top top', end: 'bottom top', scrub: true } })
      }

      const intro = () => {
        const sec = q('.intro')
        const title = q('.intro-title')
        if (!sec || !title) return
        const split = SplitText.create(title, { type: 'lines', mask: 'lines' })
        gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 70%', once: true } })
          .from(split.lines, { yPercent: 108, duration: 0.9, ease: 'power4.out', stagger: 0.1 })
          .from(q('.intro .statement'), { y: 24, autoAlpha: 0, duration: 0.7, ease: EASE }, '-=0.45')
          .from(q('.mark-bar'), { scaleX: 0, transformOrigin: 'left center', duration: 0.9, ease: 'power2.inOut' }, '+=0.05')
        const incidents = qa('.incidents li')
        gsap.set(incidents, { autoAlpha: 0, y: 36 })
        ScrollTrigger.batch(incidents, { start: 'top 88%', once: true, onEnter: (b) => { gsap.to(b, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE, stagger: 0.12 }) } })
      }

      const poster = () => {
        const items = qa('.poster-item')
        gsap.set(items, { autoAlpha: 0, x: -48 })
        ScrollTrigger.batch(items, { start: 'top 90%', once: true, onEnter: (b) => { gsap.to(b, { autoAlpha: 1, x: 0, duration: 0.7, ease: EASE, stagger: 0.09 }) } })
        const segs = qa('.poster .rb-seg')
        if (segs.length) gsap.from(segs, { scaleX: 0, transformOrigin: 'left center', duration: 0.9, ease: 'power2.inOut', stagger: 0.12, scrollTrigger: { trigger: q('.poster-split'), start: 'top 88%', once: true } })
      }

      const gatesPinned = () => {
        const sec = q('.gates7')
        const panels = qa('.gate-panel')
        const fields = qa('.g7-field')
        const fill = q('.g7-fill')
        const steps = qa('.g7-step')
        if (!sec || !fill || panels.length < 2) return
        sec.classList.add('is-pinned')
        undo.push(() => { sec.classList.remove('is-pinned'); sec.dataset.gate = 'intent'; sec.dataset.ink = GATE_INK.intent })
        const ids = panels.map((p) => p.dataset.gate ?? '')
        const rail = document.querySelector<HTMLElement>('.chapter-rail')
        let current = -1
        const setActive = (i: number) => {
          if (i === current) return
          current = i
          sec.dataset.gate = ids[i]
          sec.dataset.ink = GATE_INK[ids[i]]
          rail?.style.setProperty('--rail-ink', GATE_INK[ids[i]])
          steps.forEach((s, j) => { s.classList.toggle('is-done', j < i); s.classList.toggle('is-on', j === i) })
        }
        setActive(0)
        const splits = panels.map((p) => SplitText.create(p.querySelector('.gp-name')!, { type: 'lines', mask: 'lines' }))
        gsap.set([...panels.slice(1), ...fields.slice(1)], { autoAlpha: 0 })
        gsap.set(fill, { scaleX: 1 / panels.length, transformOrigin: 'left center' })
        gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 65%', once: true } })
          .from(splits[0].lines, { yPercent: 108, duration: 0.9, ease: 'power4.out', stagger: 0.08 })
          .from(qa('.gp-who, .gp-detail, .gp-art', panels[0]), { y: 24, autoAlpha: 0, duration: 0.7, ease: EASE, stagger: 0.08 }, '-=0.6')

        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: sec, start: 'top top', end: () => `+=${Math.round(window.innerHeight * 1.5)}`, pin: true, scrub: 0.4, anticipatePin: 1, invalidateOnRefresh: true,
            onUpdate: (st) => {
              const t = st.progress * tl.duration()
              let i = 0
              for (let k = 1; k < panels.length; k++) if (t >= tl.labels[`g${k}`] + 0.15) i = k
              setActive(i)
            },
          },
        })
        tl.to({}, { duration: 0.2 })
        panels.forEach((p, i) => {
          if (i === 0) return
          const at = `g${i}`
          const recolour = fieldOf(fields[i - 1]) !== fieldOf(fields[i])
          const textAt = recolour ? 0.22 : 0.12
          tl.addLabel(at)
          tl.to(panels[i - 1], { autoAlpha: 0, y: -28, duration: 0.12, ease: 'power2.in' }, at)
          tl.set(fields[i], { autoAlpha: 1 }, at)
          if (recolour) tl.fromTo(fields[i], { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.4, ease: 'power1.inOut', immediateRender: false }, at)
          tl.to(fill, { scaleX: (i + 1) / panels.length, duration: 0.4 }, at)
          tl.set(p, { autoAlpha: 1 }, `${at}+=${textAt}`)
          tl.from(splits[i].lines, { yPercent: 108, duration: 0.3, ease: 'power3.out', stagger: 0.06 }, `${at}+=${textAt}`)
          tl.from(qa('.gp-who, .gp-detail, .gp-art', p), { y: 24, autoAlpha: 0, duration: 0.3, ease: 'power3.out', stagger: 0.05 }, `${at}+=${textAt + 0.08}`)
          if (ids[i] === 'execute') tl.from(qa('.ga-half', p), { yPercent: 14, autoAlpha: 0, duration: 0.3, ease: 'power3.out', stagger: 0.14 }, `${at}+=0.5`)
          tl.to({}, { duration: i === panels.length - 1 ? 0.5 : 0.25 })
        })
      }

      const gatesStacked = () => {
        const panels = qa('.gate-panel')
        gsap.set(panels.map((p) => p.querySelector('.gp-inner')), { autoAlpha: 0, y: 40 })
        ScrollTrigger.batch(panels, { start: 'top 85%', once: true, onEnter: (b) => { gsap.to(b.map((p) => p.querySelector('.gp-inner')), { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE, stagger: 0.1 }) } })
      }

      const records = () => {
        const sec = q('.records')
        if (!sec) return
        gsap.from(qa('.records-names button'), { x: -28, autoAlpha: 0, duration: 0.6, ease: EASE, stagger: 0.07, scrollTrigger: { trigger: sec, start: 'top 70%', once: true } })
        const stage = q('.records-stage')
        if (stage) gsap.from(stage, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1.1, ease: 'power3.inOut', scrollTrigger: { trigger: sec, start: 'top 70%', once: true } })
      }

      const leaves = () => {
        const sec = q('.leaves')
        const title = q('.leaves-title')
        if (!sec || !title) return
        sec.classList.add('is-precut')
        undo.push(() => sec.classList.remove('is-precut'))
        const words = SplitText.create(title, { type: 'words', mask: 'words' })
        gsap.set(words.words, { yPercent: 110 })
        ScrollTrigger.create({
          trigger: sec, start: 'top 55%',
          onEnter: () => { sec.classList.remove('is-precut'); gsap.to(words.words, { yPercent: 0, duration: 0.7, ease: 'power4.out', stagger: 0.09, overwrite: true }) },
          onLeaveBack: () => sec.classList.add('is-precut'),
        })
        gsap.from(q('.leaves-lede'), { y: 20, autoAlpha: 0, duration: 0.7, ease: EASE, scrollTrigger: { trigger: sec, start: 'top 50%', once: true } })
        qa('.leave').forEach((block) => {
          const pic = block.querySelector('img, video')
          gsap.timeline({ scrollTrigger: { trigger: block, start: 'top 82%', once: true } })
            .from(block.querySelector('h3'), { y: 20, autoAlpha: 0, duration: 0.6, ease: EASE })
            .from(pic, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.9, ease: 'power3.inOut' }, '-=0.35')
            .from(qa('li', block), { x: 16, autoAlpha: 0, duration: 0.45, ease: EASE, stagger: 0.06 }, '-=0.6')
        })
      }

      const proof = () => {
        const top = qa('.proof-intro > *, .proof-facts li')
        if (top.length) gsap.from(top, { y: 24, autoAlpha: 0, duration: 0.7, ease: EASE, stagger: 0.07, scrollTrigger: { trigger: q('.proof-top'), start: 'top 85%', once: true } })
        const tiles = qa('.proof .tile')
        gsap.set(tiles, { autoAlpha: 0, y: 28 })
        ScrollTrigger.batch(tiles, {
          start: 'top 92%', once: true,
          onEnter: (b) => { gsap.to(b, { autoAlpha: 1, y: 0, duration: 0.55, ease: EASE, stagger: 0.06 }) },
        })
      }

      const bank = () => {
        const panel = q('.bankpanel')
        const title = q('.bp-title')
        if (!panel || !title) return
        panel.classList.add('is-open')
        undo.push(() => panel.classList.remove('is-open'))
        const words = SplitText.create(title, { type: 'words', mask: 'words' })
        gsap.set(words.words, { yPercent: 110 })
        ScrollTrigger.create({
          trigger: panel, start: 'top 45%',
          onEnter: () => { panel.classList.remove('is-open'); gsap.to(words.words, { yPercent: 0, duration: 0.7, ease: 'power4.out', stagger: 0.08, overwrite: true }) },
          onLeaveBack: () => panel.classList.add('is-open'),
        })
        const door = q('.bp-door img')
        if (door) gsap.fromTo(door, { rotate: -60 }, { rotate: 0, ease: 'none', scrollTrigger: { trigger: panel, start: 'top bottom', end: 'top 35%', scrub: true } })
        gsap.fromTo(qa('.bp-block, .bp-now, .bankpanel .button'), { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: EASE, stagger: 0.1, scrollTrigger: { trigger: panel, start: 'top 40%', once: true } })
      }

      hero()
      intro()
      poster()
      if (wide) gatesPinned()
      else gatesStacked()
      records()
      leaves()
      proof()
      bank()
      ScrollTrigger.refresh()
    }
    return () => undo.forEach((f) => f())
  })

  const refresh = () => ScrollTrigger.refresh()
  window.addEventListener('load', refresh)
  const late = window.setTimeout(refresh, 1500)
  return () => {
    window.removeEventListener('load', refresh)
    window.clearTimeout(late)
    mm.revert()
    html.classList.remove('motion-pending')
  }
}
