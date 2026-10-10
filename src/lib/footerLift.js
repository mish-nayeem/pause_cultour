import { useEffect } from 'react'

// The floating FILTER and CART pills sit at the bottom of the screen; once
// the footer scrolls up into view they ride up with it, parked just above
// it, instead of covering it or disappearing. This keeps --footer-lift on
// <html> at however many pixels of footer are showing; the pills add it to
// their `bottom`.
export function useFooterLift() {
  useEffect(() => {
    const root = document.documentElement
    let frame = 0

    function measure() {
      frame = 0
      const footer = document.querySelector('footer')
      const showing = footer ? Math.max(0, window.innerHeight - footer.getBoundingClientRect().top) : 0
      root.style.setProperty('--footer-lift', `${Math.round(showing)}px`)
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // The footer can arrive or move after first paint (the catalog loading in).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(document.body)

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
      root.style.removeProperty('--footer-lift')
    }
  }, [])
}
