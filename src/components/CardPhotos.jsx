import { useEffect, useRef, useState } from 'react'
import { imgUrl } from '../lib/images.js'
import ShimmerImage from './ShimmerImage.jsx'

// How long each photo shows while the pointer rests on a card.
const STEP_MS = 2200

// How far a finger has to travel sideways for a swipe to change the photo.
const SWIPE_PX = 30

// A photo wider than the card (a landscape shot in a portrait card) would
// lose its sides to the crop — shoes and chair cut off. Those show whole
// instead, over a blurred, filled copy of themselves so the card has no
// empty bars. Portrait photos fill the card as before.
// `under`: a photo already on screen (the card's first) shown behind this
// one until it has loaded — so a swipe onto a photo still on its way shows
// a photo, never a blank frame.
function FitPhoto({ src, alt = '', loading, shimmer = false, under }) {
  const box = useRef(null)
  const [wide, setWide] = useState(false)
  function check(img) {
    if (img?.naturalWidth && img.naturalWidth / img.naturalHeight > 0.9) setWide(true)
  }
  // Already in the cache: it may have loaded before onLoad was listening.
  useEffect(() => {
    const img = box.current?.querySelector('img.card-fit-main')
    if (img?.complete) check(img)
  }, [src])
  const Img = shimmer ? ShimmerImage : 'img'
  return (
    <span
      className={`card-fit ${wide ? 'wide' : ''}`}
      ref={box}
      style={under ? { backgroundImage: `url("${under}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {wide && <img className="card-fit-bg" src={src} alt="" aria-hidden="true" />}
      <Img className="card-fit-main" src={src} alt={alt} loading={loading} onLoad={(e) => check(e.currentTarget)} />
    </span>
  )
}

// A shop card's photos. Resting the mouse pointer on the photo slides
// through the product's other photos one by one; moving off slides back to
// the first. On a phone, swiping the photo left or right moves through them
// by hand, the strip following the finger. A tap or a click opens the
// product as always — a swipe doesn't.
//
// It goes round in a circle: after the last photo the strip keeps sliding
// the same way onto a copy of the first, then quietly swaps to the real
// first — so it never sweeps back across every photo in reverse.
// A finger's swipe settles on the easing iOS uses: quick off the mark, a
// long soft landing.
const TOUCH_EASE = 'transform 0.42s cubic-bezier(0.22, 1, 0.36, 1)'

export function CardPhoto({ images, alt, width = 500, loading }) {
  const list = Array.isArray(images) ? images.filter(Boolean) : []
  const count = list.length
  // 0 … count; `count` is the copy of the first photo at the end. The state
  // only drives the dots — the strip itself is moved by writing its
  // transform straight to the element, so a finger dragging it never waits
  // on a re-render.
  const [index, setIndexState] = useState(0)
  const at = useRef(0)
  // The other photos load once someone points at the card — or, on a
  // phone, as it scrolls near the screen, so they're there before a swipe.
  const [woken, setWoken] = useState(false)
  const timer = useRef(null)
  const track = useRef(null)

  // ease: 'hover' (the stylesheet's slow slide), 'touch' or false (a jump).
  function place(n, ease, dx = 0) {
    const el = track.current
    if (!el) return
    el.style.transition = ease === 'hover' ? '' : ease === 'touch' ? TOUCH_EASE : 'none'
    el.style.transform = dx ? `translate3d(calc(${-n * 100}% + ${dx}px), 0, 0)` : `translate3d(${-n * 100}%, 0, 0)`
  }
  const landTimer = useRef(0)
  function go(n, ease = 'hover') {
    at.current = n
    setIndexState(n)
    place(n, ease)
    // Sliding onto the copy of the first: swap to the real first once the
    // slide is done. transitionend can go missing (the tab hidden, the
    // slide cut short), so a timer makes sure the strip never stays on the
    // copy — staying there is what left a blank frame on the next swipe.
    clearTimeout(landTimer.current)
    if (n === count && ease) {
      landTimer.current = setTimeout(() => { if (at.current === count) go(0, false) }, ease === 'hover' ? 950 : 500)
    }
  }
  // Two frames: one to paint the jump without a transition, one to turn the
  // transition back on.
  function afterJump(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn))
  }
  function forward(ease) {
    if (at.current < count) return go(at.current + 1, ease)
    // Still on the copy of the first (the swap hadn't happened yet): jump
    // to the real first, then on to the second — round in a circle.
    go(0, false)
    afterJump(() => go(1, ease))
  }
  function back(ease) {
    if (at.current === count) {
      go(0, false)
      afterJump(() => back(ease))
      return
    }
    if (at.current > 0) return go(at.current - 1, ease)
    // From the first, jump to its copy at the end and slide back from there.
    go(count, false)
    afterJump(() => go(count - 1, ease))
  }
  // Landed on the copy of the first: swap to the real one, unseen.
  function landed(e) {
    if (e.target !== track.current || at.current !== count) return
    go(0, false)
  }

  // Phones: wake the card a screen ahead of it, so its photos have loaded
  // by the time a finger reaches it.
  useEffect(() => {
    const box = track.current?.parentElement
    if (!box || count < 2 || woken || !window.matchMedia?.('(hover: none)').matches || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        setWoken(true)
        io.disconnect()
      }
    }, { rootMargin: '100% 0px' })
    io.observe(box)
    return () => io.disconnect()
  }, [count, woken])

  // Listens on the whole photo box (the strip's parent), so pointing at a
  // badge or the + button over the photo doesn't stop the slideshow.
  useEffect(() => {
    const box = track.current?.parentElement
    if (!box || count < 2) return
    function start(e) {
      if (e.pointerType !== 'mouse') return
      setWoken(true)
      clearInterval(timer.current)
      forward()
      timer.current = setInterval(forward, STEP_MS)
    }
    // A finger lifting off fires pointerleave too — only the mouse resets.
    function stop(e) {
      if (e.pointerType !== 'mouse') return
      clearInterval(timer.current)
      // Back to the first by the short way round.
      if (at.current === 0 || at.current === count) return
      if (at.current >= count / 2) go(count)
      else go(0)
    }

    // Touch: the strip follows the finger frame by frame, and letting go
    // past SWIPE_PX — or with a quick flick — glides one photo that way;
    // otherwise it springs back. An up/down drag is left to the page.
    let x0 = 0
    let y0 = 0
    let t0 = 0
    let dir = null // null until the finger's moved enough to tell | 'x' | 'y'
    let swiped = false
    let frame = 0
    function touchStart(e) {
      if (e.touches.length !== 1) return
      setWoken(true)
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
      t0 = performance.now()
      dir = null
      swiped = false
    }
    function touchMove(e) {
      const dx = e.touches[0].clientX - x0
      const dy = e.touches[0].clientY - y0
      if (!dir && Math.abs(dx) + Math.abs(dy) > 8) dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (dir !== 'x') return
      if (e.cancelable) e.preventDefault()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => place(at.current, false, dx))
    }
    function touchEnd(e) {
      if (dir !== 'x') return
      cancelAnimationFrame(frame)
      const dx = e.changedTouches[0].clientX - x0
      const speed = Math.abs(dx) / Math.max(1, performance.now() - t0) // px per ms
      // Any sideways drag isn't a tap — even one that springs back mustn't
      // open the product.
      swiped = true
      if (Math.abs(dx) < SWIPE_PX && !(speed > 0.35 && Math.abs(dx) > 12)) {
        place(at.current, 'touch')
        return
      }
      if (dx < 0) forward('touch')
      else back('touch')
    }
    // The browser can take a touch over midway (to scroll the page) and
    // cancel it, with no touchend — the strip springs back to its photo
    // instead of being left halfway, showing a strip of blank.
    function touchCancel() {
      cancelAnimationFrame(frame)
      if (dir === 'x') place(at.current, 'touch')
      dir = null
    }
    // The card is a link: a swipe mustn't open the product.
    function click(e) {
      if (!swiped) return
      swiped = false
      e.preventDefault()
      e.stopPropagation()
    }

    box.addEventListener('pointerenter', start)
    box.addEventListener('pointerleave', stop)
    box.addEventListener('touchstart', touchStart, { passive: true })
    box.addEventListener('touchmove', touchMove, { passive: false })
    box.addEventListener('touchend', touchEnd)
    box.addEventListener('touchcancel', touchCancel)
    box.addEventListener('click', click, true)
    return () => {
      clearInterval(timer.current)
      box.removeEventListener('pointerenter', start)
      box.removeEventListener('pointerleave', stop)
      box.removeEventListener('touchstart', touchStart)
      box.removeEventListener('touchmove', touchMove)
      box.removeEventListener('touchend', touchEnd)
      box.removeEventListener('touchcancel', touchCancel)
      clearTimeout(landTimer.current)
      box.removeEventListener('click', click, true)
    }
  }, [count])

  if (count < 2) {
    return <FitPhoto shimmer src={imgUrl(list[0], { w: width })} alt={alt} loading={loading} />
  }

  return (
    <>
      <span className="card-track" ref={track} onTransitionEnd={landed}>
        <FitPhoto shimmer src={imgUrl(list[0], { w: width })} alt={alt} loading={loading} />
        {list.slice(1).map((src) =>
          woken
            ? <FitPhoto key={src} src={imgUrl(src, { w: width })} under={imgUrl(list[0], { w: width })} />
            : <span key={src} className="card-track-wait" style={{ backgroundImage: `url("${imgUrl(list[0], { w: width })}")` }} />
        )}
        {/* The copy of the first photo the circle slides onto — always
            there, so coming round from the last never shows a blank. */}
        <FitPhoto src={imgUrl(list[0], { w: width })} under={imgUrl(list[0], { w: width })} />
      </span>
      <span className="card-dots" aria-hidden="true">
        {list.map((src, i) => <i key={src} className={i === index % count ? 'on' : ''} />)}
      </span>
    </>
  )
}
