import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { CustomEase } from 'gsap/CustomEase'

gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase)
CustomEase.create('pmInOut', '0.645,0.045,0.355,1')
CustomEase.create('pmOut', '0.16,1,0.3,1')

export function initLandingMotion(root: HTMLElement): () => void {
  const html = document.documentElement
  const q = (sel: string) => root.querySelector<HTMLElement>(sel)
  const qa = (sel: string, scope: ParentNode = root) => Array.from(scope.querySelectorAll<HTMLElement>(sel))
  const mm = gsap.matchMedia()

  mm.add({ motion: '(prefers-reduced-motion: no-preference)', wide: '(min-width: 768px)' }, (ctx) => {
    const { motion, wide } = ctx.conditions as { motion: boolean; wide: boolean }
    if (!motion) {
      html.classList.remove('motion-pending')
      return
    }
    root.classList.add('is-moving')
    // Start states are applied inside the first GSAP tick, so a page whose frames never run stays fully visible.
    gsap.delayedCall(0, () => ctx.add(() => setup()))
    const setup = () => {
      const hero = () => {
        const h1 = q('.pm-hero-title')
        if (!h1) return
        const split = SplitText.create(h1, { type: 'words', mask: 'words' })
        gsap.set(split.words, { yPercent: 40, autoAlpha: 0 })
        html.classList.remove('motion-pending')
        gsap.to(split.words, { yPercent: 0, autoAlpha: 1, duration: 0.9, stagger: 0.08, ease: 'pmOut', delay: 0.1 })
        gsap.from(qa('.pm-hero-sub, .pm-pair, .pm-hero-chips', q('.pm-hero') ?? root), { y: 12, autoAlpha: 0, duration: 0.9, stagger: 0.1, ease: 'pmOut', delay: 0.45 })
        gsap.from(q('.pm-nav'), { autoAlpha: 0, duration: 0.6, ease: 'pmOut', delay: 0.2 })
      }

      const curtain = () => {
        const burst = q('.pm-burst')
        const curtainEl = q('.pm-curtain')
        if (!burst || !curtainEl) return
        gsap.fromTo(burst, { opacity: 1, scale: 1 }, { opacity: 0.3, scale: 1.12, ease: 'none', scrollTrigger: { trigger: curtainEl, start: 'top bottom', end: 'top top', scrub: true } })
      }

      const wipe = () => {
        const sec = q('.pm-wipe')
        if (!sec) return
        const hole = q('.pm-wipe-hole')
        const black = q('.pm-wipe-black')
        const head = q('.pm-wipe-head')
        const layers = qa('.pm-stripe-layer')
        const orange = q('.pm-stripe-orange')
        if (!wide) {
          gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 70%', once: true } })
            .fromTo(hole, { scaleX: 0.1, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 1, ease: 'pmInOut' })
            .from(head, { y: 24, autoAlpha: 0, duration: 0.8, ease: 'pmOut' }, '-=0.5')
          return
        }
        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: sec, start: 'top top', end: '+=100%', pin: true, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true },
        })
        layers.forEach((l, i) => tl.fromTo(l, { xPercent: [-6, 10, -14][i] ?? 0 }, { xPercent: [8, -12, 20][i] ?? 0, duration: 1 }, 0))
        tl.fromTo(hole, { scaleX: 0.05, autoAlpha: 0 }, { scaleX: 0.85, autoAlpha: 1, duration: 0.45, ease: 'pmInOut' }, 0.15)
        tl.fromTo(head, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.25, ease: 'pmOut' }, 0.4)
        tl.fromTo(black, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 0.7)
        if (orange) tl.fromTo(orange, { x: 0, autoAlpha: 0 }, { keyframes: [{ autoAlpha: 1, duration: 0.02 }, { x: () => window.innerWidth * 0.84, duration: 0.22 }, { autoAlpha: 0, duration: 0.02 }] }, 0.48)
      }

      const rail = () => {
        const railEl = q('.pm-rail')
        const marker = q('.pm-rail-marker')
        const line = q('.pm-rail-line')
        if (!railEl || !marker || !line) return
        gsap.fromTo(marker, { y: 0 }, { y: () => line.offsetHeight - 8, ease: 'none', scrollTrigger: { trigger: railEl, start: 'top center', end: 'bottom center', scrub: true, invalidateOnRefresh: true } })
        railEl.classList.add('is-tracking')
        qa('.pm-step', railEl).forEach((card) => {
          gsap.from(card, { y: 60, autoAlpha: 0, duration: 0.9, ease: 'pmOut', immediateRender: false, scrollTrigger: { trigger: card, start: 'top bottom', once: true } })
          ScrollTrigger.create({
            trigger: card, start: 'top 70%', end: 'bottom 40%',
            onToggle: (st) => { card.classList.toggle('is-active', st.isActive); if (st.isActive) card.classList.add('was-active') },
          })
        })
      }

      const words = () => {
        const h = q('.pm-reveal-words')
        if (h) {
          const split = SplitText.create(h, { type: 'words', mask: 'words' })
          gsap.from(split.words, { yPercent: 100, duration: 0.9, stagger: 0.05, ease: 'pmOut', scrollTrigger: { trigger: h, start: 'top 75%', once: true } })
        }
        const s = q('.pm-scrub-words')
        if (s) {
          const split = SplitText.create(s, { type: 'words', mask: 'words' })
          gsap.from(split.words, { yPercent: 100, duration: 0.9, stagger: 0.05, ease: 'pmOut', scrollTrigger: { trigger: s, start: 'top 75%', once: true } })
          gsap.fromTo(split.words, { color: '#8C9691' }, { color: '#FFFFFF', stagger: 0.1, ease: 'none', scrollTrigger: { trigger: s, start: 'top 75%', end: 'bottom 35%', scrub: true } })
        }
      }

      const blocks = () => {
        const items = qa('.pm-stat, .pm-card, .pm-fact, .pm-built-item, .pm-lede, .pm-cta-pair')
        ScrollTrigger.batch(items, {
          start: 'top bottom', once: true,
          onEnter: (batch) => { gsap.from(batch, { y: 24, autoAlpha: 0, duration: 0.7, stagger: 0.06, ease: 'pmOut' }) },
        })
      }

      hero()
      curtain()
      wipe()
      rail()
      words()
      blocks()
      ScrollTrigger.refresh()
    }
    return () => root.classList.remove('is-moving')
  })

  const refresh = () => ScrollTrigger.refresh()
  window.addEventListener('load', refresh)
  const late = window.setTimeout(refresh, 1500)
  // Live stats can mount after setup and change the page height, which would leave pin and rail offsets stale.
  let lastHeight = root.offsetHeight
  let pending = 0
  const resize = new ResizeObserver(() => {
    if (root.offsetHeight === lastHeight) return
    lastHeight = root.offsetHeight
    window.clearTimeout(pending)
    pending = window.setTimeout(refresh, 200)
  })
  resize.observe(root)
  return () => {
    window.removeEventListener('load', refresh)
    window.clearTimeout(late)
    window.clearTimeout(pending)
    resize.disconnect()
    mm.revert()
    html.classList.remove('motion-pending')
  }
}
