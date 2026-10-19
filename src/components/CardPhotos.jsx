import { useEffect, useRef, useState } from 'react'
import { imgUrl } from '../lib/images.js'
import ShimmerImage from './ShimmerImage.jsx'

// How long each photo shows while the pointer rests on a card.
const STEP_MS = 2200

// How far a finger has to travel sideways for a swipe to change the photo.
const SWIPE_PX = 30

// A shop card's photos. Resting the mouse pointer on the photo slides
// through the product's other photos one by one; moving off slides back to
// the first. On a phone, swiping the photo left or right moves through them
// by hand, the strip following the finger. A tap or a click opens the
// product as always — a swipe doesn't.
//
// It goes round in a circle: after the last photo the strip keeps sliding
// the same way onto a copy of the first, then quietly swaps to the real
// first — so it never sweeps back across every photo in reverse.
export function CardPhoto({ images, alt, width = 500, loading }) {
  const list = Array.isArray(images) ? images.filter(Boolean) : []
  const count = list.length
  // 0 … count; `count` is the copy of the first photo at the end.
  const [index, setIndexState] = useState(0)
  const at = useRef(0)
  // True for the one frame a swap to/from the copy must not animate.
  const [instant, setInstant] = useState(false)
  // Pixels the finger has dragged the strip, while a swipe is under way.
  const [drag, setDrag] = useState(0)
  // The other photos only load once someone points at the card.
  const [woken, setWoken] = useState(false)
  const timer = useRef(null)
  const track = useRef(null)

  function go(n) {
    at.current = n
    setIndexState(n)
  }
  // Two frames: one to paint the jump without a transition, one to turn the
  // transition back on.
  function afterJump(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn))
  }
  function forward() {
    if (at.current < count) go(at.current + 1)
  }
  function back() {
    if (at.current > 0) return go(at.current - 1)
    // From the first, jump to its copy at the end and slide back from there.
    setInstant(true)
    go(count)
    afterJump(() => {
      setInstant(false)
      go(count - 1)
    })
  }
  // Landed on the copy of the first: swap to the real one, unseen.
  function landed(e) {
    if (e.target !== track.current || at.current !== count) return
    setInstant(true)
    go(0)
    afterJump(() => setInstant(false))
  }

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

    // Touch: the strip follows a sideways drag, and letting go past
    // SWIPE_PX steps one photo that way. An up/down drag is left to the page.
    let x0 = 0
    let y0 = 0
    let dir = null // null until the finger's moved enough to tell | 'x' | 'y'
    let swiped = false
    function touchStart(e) {
      if (e.touches.length !== 1) return
      setWoken(true)
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
      dir = null
      swiped = false
    }
    function touchMove(e) {
      const dx = e.touches[0].clientX - x0
      const dy = e.touches[0].clientY - y0
      if (!dir && Math.abs(dx) + Math.abs(dy) > 8) dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (dir !== 'x') return
      if (e.cancelable) e.preventDefault()
      setDrag(dx)
    }
    function touchEnd(e) {
      if (dir !== 'x') return
      const dx = e.changedTouches[0].clientX - x0
      setDrag(0)
      if (Math.abs(dx) < SWIPE_PX) return
      swiped = true
      if (dx < 0) forward()
      else back()
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
    box.addEventListener('click', click, true)
    return () => {
      clearInterval(timer.current)
      box.removeEventListener('pointerenter', start)
      box.removeEventListener('pointerleave', stop)
      box.removeEventListener('touchstart', touchStart)
      box.removeEventListener('touchmove', touchMove)
      box.removeEventListener('touchend', touchEnd)
      box.removeEventListener('click', click, true)
    }
  }, [count])

  if (count < 2) {
    return <ShimmerImage src={imgUrl(list[0], { w: width })} alt={alt} loading={loading} />
  }

  return (
    <>
      <span
        className={`card-track ${drag || instant ? 'dragging' : ''}`}
        ref={track}
        style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))` }}
        onTransitionEnd={landed}
      >
        <ShimmerImage src={imgUrl(list[0], { w: width })} alt={alt} loading={loading} />
        {list.slice(1).map((src) =>
          woken ? <img key={src} src={imgUrl(src, { w: width })} alt="" /> : <span key={src} className="card-track-wait" />
        )}
        {/* The copy of the first photo the circle slides onto. */}
        {woken ? <img src={imgUrl(list[0], { w: width })} alt="" /> : <span className="card-track-wait" />}
      </span>
      <span className="card-dots" aria-hidden="true">
        {list.map((src, i) => <i key={src} className={i === index % count ? 'on' : ''} />)}
      </span>
    </>
  )
}
