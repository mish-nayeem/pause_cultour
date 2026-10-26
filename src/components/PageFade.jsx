import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// Going from one page to another: the new page fades in (and rises a
// touch) instead of appearing with a white flash. Only the page's content —
// the nav stays put — and nothing in the admin, or with reduced motion.
// Opacity only on the wrapper's children that aren't fixed in place, so a
// sticky or fixed bar inside a page is never thrown off by it.
export default function PageFade({ children }) {
  const { pathname } = useLocation()
  const ref = useRef(null)
  const first = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (first.current) { first.current = false; return }
    if (pathname.startsWith('/admin')) return
    el.classList.remove('page-in')
    void el.offsetWidth
    el.classList.add('page-in')
    // Off again once played, so it never stands in for a page part's own
    // animation (a sheet, a panel) opened later.
    const t = setTimeout(() => el.classList.remove('page-in'), 520)
    return () => clearTimeout(t)
  }, [pathname])

  return <div className="page-fade" ref={ref}>{children}</div>
}
