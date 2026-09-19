import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

// Eased, inertial scrolling for the whole site — storefront and admin alike.
// The mouse wheel glides to a stop instead of jumping a fixed step per notch.
// Touch screens and trackpads keep the browser's own momentum (Lenis leaves
// them alone), and anyone who has asked their system for less motion gets
// ordinary scrolling.
//
// One instance for the page's lifetime, so code that needs to move the scroll
// position goes through the helpers below: while Lenis is running it owns the
// position, and a plain window.scrollTo would fight it.

let lenis = null

// Things that scroll on their own — text areas, dropdowns, anything marked
// data-lenis-prevent — are handed back to the browser. So is the whole page
// while a menu or panel has locked it (body overflow: hidden), which is how
// the mobile menu and the details panel stop the page moving behind them.
function shouldLeaveToBrowser(node) {
  if (document.body.style.overflow === 'hidden') return true
  return Boolean(node.closest('textarea, select, [data-lenis-prevent]'))
}

export function startSmoothScroll() {
  if (lenis) return () => {}
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}

  lenis = new Lenis({
    duration: 1.15,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    wheelMultiplier: 0.95,
    prevent: shouldLeaveToBrowser,
  })

  let frame = requestAnimationFrame(function tick(time) {
    lenis?.raf(time)
    frame = requestAnimationFrame(tick)
  })

  return () => {
    cancelAnimationFrame(frame)
    lenis?.destroy()
    lenis = null
  }
}

// Glides to an element or a pixel position. `offset` is in pixels (negative to
// stop short, e.g. below the floating nav).
export function scrollToTarget(target, { offset = 0 } = {}) {
  if (lenis) {
    lenis.scrollTo(target, { offset, duration: 1.1 })
    return
  }

  if (typeof target === 'number') {
    window.scrollTo({ top: target + offset, behavior: 'smooth' })
  } else if (target?.getBoundingClientRect) {
    const top = target.getBoundingClientRect().top + window.scrollY + offset
    window.scrollTo({ top, behavior: 'smooth' })
  }
}

// A new page starts at the top, with no glide.
export function jumpToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true })
  else window.scrollTo(0, 0)
}
