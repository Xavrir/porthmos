let started = false

export function startReveal() {
  if (started || typeof window === 'undefined') return
  started = true
  const show = (el: Element) => el.classList.add('is-in')
  if (!('IntersectionObserver' in window)) {
    new MutationObserver(() => document.querySelectorAll('[data-reveal]:not(.is-in)').forEach(show)).observe(document.body, { childList: true, subtree: true })
    return
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      show(e.target)
      io.unobserve(e.target)
    }
  }, { rootMargin: '0px 0px -4% 0px', threshold: 0 })
  const watch = (root: ParentNode) => root.querySelectorAll('[data-reveal]:not(.is-in)').forEach((el) => io.observe(el))
  watch(document)
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (!(n instanceof Element)) continue
      if (n.matches('[data-reveal]:not(.is-in)')) io.observe(n)
      watch(n)
    }
  }).observe(document.body, { childList: true, subtree: true })
}
