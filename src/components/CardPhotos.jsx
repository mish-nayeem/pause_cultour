import { useEffect, useRef, useState } from 'react'
import { imgUrl } from '../lib/images.js'
import ShimmerImage from './ShimmerImage.jsx'

// How long each photo shows while the pointer rests on a card.
const STEP_MS = 1300

// How far a finger has to travel sideways for a swipe to change the photo.
const SWIPE_PX = 30

// A shop card's photos. Resting the mouse pointer on the photo slides
// through the product's other photos one by one; moving off slides back to
// the first. On a phone, swiping the photo left or right moves through them
// by hand, the strip following the finger. A tap or a click opens the
// product as always — a swipe doesn't.
export function CardPhoto({ images, alt, width = 500, loading }) {
  const list = Array.isArray(images) ? images.filter(Boolean) : []
  const count = list.length
  const [index, setIndex] = useState(0)
  // Pixels the finger has dragged the strip, while a swipe is under way.
  const [drag, setDrag] = useState(0)
  // The other photos only load once someone points at the card.
  const [woken, setWoken] = useState(false)
  const timer = useRef(null)
  const track = useRef(null)

  // Listens on the whole photo box (the strip's parent), so pointing at a
  // badge or the + button over the photo doesn't stop the slideshow.
  useEffect(() => {
    const box = track.current?.parentElement
    if (!box || count < 2) return
    function start(e) {
      if (e.pointerType !== 'mouse') return
      setWoken(true)
      clearInterval(timer.current)
      setIndex(1)
      timer.current = setInterval(() => setIndex((i) => (i + 1) % count), STEP_MS)
    }
    // A finger lifting off fires pointerleave too — only the mouse resets.
    function stop(e) {
      if (e.pointerType !== 'mouse') return
      clearInterval(timer.current)
      setIndex(0)
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
      setIndex((i) => (dx < 0 ? (i + 1) % count : (i - 1 + count) % count))
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
        className={`card-track ${drag ? 'dragging' : ''}`}
        ref={track}
        style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))` }}
      >
        <ShimmerImage src={imgUrl(list[0], { w: width })} alt={alt} loading={loading} />
        {list.slice(1).map((src) =>
          woken ? <img key={src} src={imgUrl(src, { w: width })} alt="" /> : <span key={src} className="card-track-wait" />
        )}
      </span>
      <span className="card-dots" aria-hidden="true">
        {list.map((src, i) => <i key={src} className={i === index ? 'on' : ''} />)}
      </span>
    </>
  )
}
