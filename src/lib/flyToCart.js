import { imgUrl } from './images.js'

// "Added to cart": the product's photo lifts off where it was tapped, flies
// in an arc into the cart in the nav (the bag on phones) and the cart gives
// a little bounce. Purely a flourish — nothing waits for it, and with
// reduced motion only the bounce plays.

const onScreen = (el) => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) return null
  return r
}

// The cart button that's showing: the CART link on wide screens, the bag
// on phones (both carry data-cart-target).
function cartTarget() {
  for (const el of document.querySelectorAll('[data-cart-target]')) if (onScreen(el)) return el
  return null
}

function bump(el) {
  el.classList.remove('cart-bump')
  // Restarts the animation if it's still running from the last add.
  void el.offsetWidth
  el.classList.add('cart-bump')
  setTimeout(() => el.classList.remove('cart-bump'), 650)
}

// `from`: the element(s) to start from — the first one on screen is used.
export function flyToCart({ from, image }) {
  if (typeof window === 'undefined') return
  const target = cartTarget()
  if (!target) return
  const start = [].concat(from).map(onScreen).find(Boolean)
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!start || !image || reduced || !document.body.animate) return bump(target)

  const size = Math.max(56, Math.min(120, Math.min(start.width, start.height) * 0.6))
  const sx = start.left + start.width / 2 - size / 2
  const sy = start.top + start.height / 2 - size / 2
  const t = target.getBoundingClientRect()
  const dx = t.left + t.width / 2 - (sx + size / 2)
  const dy = t.top + t.height / 2 - (sy + size / 2)

  const img = document.createElement('img')
  img.src = imgUrl(image, { w: 240 })
  img.alt = ''
  img.setAttribute('aria-hidden', 'true')
  Object.assign(img.style, {
    position: 'fixed', left: `${sx}px`, top: `${sy}px`, width: `${size}px`, height: `${size}px`,
    objectFit: 'cover', borderRadius: '14px', zIndex: '9999', pointerEvents: 'none',
    boxShadow: '0 14px 34px rgba(0,0,0,0.28)', background: '#f2f2f2', willChange: 'transform, opacity',
  })
  document.body.appendChild(img)

  // An arc: up and over first, then down into the bag, shrinking on the way.
  const lift = Math.min(160, Math.abs(dy) * 0.5 + 60)
  const anim = img.animate([
    { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
    { transform: `translate(${dx * 0.45}px, ${Math.min(dy, 0) * 0.45 - lift}px) scale(0.75) rotate(-8deg)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.12) rotate(6deg)`, opacity: 0.4, offset: 1 },
  ], { duration: 820, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' })

  const done = () => { img.remove(); bump(target) }
  anim.onfinish = done
  anim.oncancel = () => img.remove()
}
