import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Things on the shop's pages rise and fade in as they scroll into view —
// product cards, headings, banners, lookbook and about photos. One observer
// for the whole site: anything matching REVEAL that turns up (on a new page,
// or when the catalog arrives) is picked up. Cards in a row follow each
// other by a beat. Once in, an element is left exactly as it was before (the
// classes come off), and with reduced motion, or in the admin, nothing moves.

const REVEAL = [
  '.scard', '.pb-card', '.empty-card', '.empty-fresh-label',
  '.shop-head', '.section-head', '.lb-head', '.lb-item', '.about-head', '.about-block', '.about-shot',
  '.reviews-head', '.rev-card', '.foot-main', '.pdp .info > *',
].join(',')

export default function ScrollReveal() {
  const { pathname } = useLocation()

  useEffect(() => {
    if (pathname.startsWith('/admin')) return
    if (!('IntersectionObserver' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const done = new WeakSet()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const el = e.target
        io.unobserve(el)
        el.classList.add('reveal-in')
        // Back to exactly how it was, after the rise has played.
        setTimeout(() => el.classList.remove('reveal', 'reveal-in'), 1600 + (parseInt(el.style.getPropertyValue('--rd')) || 0))
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })

    function scan(root) {
      const found = root.querySelectorAll ? root.querySelectorAll(REVEAL) : []
      let row = 0
      let lastTop = null
      for (const el of found) {
        if (done.has(el)) continue
        done.add(el)
        const r = el.getBoundingClientRect()
        // A beat between neighbours on the same line (a row of cards).
        const top = Math.round(r.top)
        row = top === lastTop ? row + 1 : 0
        lastTop = top
        el.style.setProperty('--rd', `${Math.min(row, 4) * 110}ms`)
        el.classList.add('reveal')
        io.observe(el)
      }
    }

    const rootEl = document.getElementById('root')
    let frame = 0
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => scan(rootEl))
    })
    // After the page has laid itself out.
    const start = requestAnimationFrame(() => scan(rootEl))
    mo.observe(rootEl, { childList: true, subtree: true })

    return () => {
      cancelAnimationFrame(start)
      cancelAnimationFrame(frame)
      mo.disconnect()
      io.disconnect()
    }
  }, [pathname])

  return null
}
