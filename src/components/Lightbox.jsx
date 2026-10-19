import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { imgUrl } from '../lib/images.js'
import './lightbox.css'

const MAX = 4 // furthest zoom
const TAP_ZOOM = 2.5 // a double-tap or a click zooms this far

// A product photo full screen. ‹ › or a swipe for the others, ✕ / Esc or a
// tap on the dark around it to close.
//
// Zoom: on a phone, pinch (or double-tap) and drag to look around; on a PC,
// the wheel zooms towards the pointer, a click zooms in or back out, and a
// drag moves the photo. The photo is moved with a transform written straight
// to the element — no re-render per frame — so it follows the fingers
// smoothly; a tap, click or wheel step eases into place instead.
export default function Lightbox({ images, start = 0, alt = '', onClose }) {
  const [i, setI] = useState(start)
  const [zoomed, setZoomed] = useState(false)
  const n = images.length
  const imgRef = useRef(null)
  const view = useRef({ s: 1, x: 0, y: 0 })
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  const lastTap = useRef({ t: 0, x: 0, y: 0 })

  const go = (d) => setI((v) => (v + d + n) % n)

  // The photo's place: scale s, and x / y from the middle of the screen.
  // Kept so its edges can't be dragged in past the screen's.
  function apply(next, ease) {
    const img = imgRef.current
    if (!img) return
    const s = Math.min(MAX, Math.max(1, next.s))
    const maxX = Math.max(0, (img.offsetWidth * s - window.innerWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * s - window.innerHeight) / 2)
    const v = {
      s,
      x: s === 1 ? 0 : Math.min(maxX, Math.max(-maxX, next.x)),
      y: s === 1 ? 0 : Math.min(maxY, Math.max(-maxY, next.y)),
    }
    view.current = v
    img.style.transition = ease ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none'
    img.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`
    setZoomed(v.s > 1.01)
  }

  // Zoom to s, keeping the point (px, py) on the screen where it is.
  function zoomAt(s, px, py, ease) {
    const cur = view.current
    const k = Math.min(MAX, Math.max(1, s)) / cur.s
    const cx = px - window.innerWidth / 2
    const cy = py - window.innerHeight / 2
    apply({ s: cur.s * k, x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k }, ease)
  }

  function toggleAt(px, py) {
    if (view.current.s > 1.01) apply({ s: 1, x: 0, y: 0 }, true)
    else zoomAt(TAP_ZOOM, px, py, true)
  }

  // A new photo starts whole.
  useEffect(() => {
    view.current = { s: 1, x: 0, y: 0 }
    if (imgRef.current) {
      imgRef.current.style.transition = 'none'
      imgRef.current.style.transform = ''
    }
    setZoomed(false)
  }, [i])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, n])

  function onPointerDown(e) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2) {
      // Pinch: remember the fingers' distance and middle, and the view then.
      const [a, b] = pts
      gesture.current = {
        type: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        start: { ...view.current },
      }
    } else if (pts.length === 1) {
      gesture.current = { type: 'drag', x0: e.clientX, y0: e.clientY, start: { ...view.current }, moved: false, onImg: e.target === imgRef.current }
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return

    if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const s = Math.min(MAX, Math.max(1, g.start.s * (dist / g.dist)))
      const k = s / g.start.s
      const cx = g.mx - window.innerWidth / 2
      const cy = g.my - window.innerHeight / 2
      // Scale about where the pinch began, then follow the fingers' middle.
      apply({ s, x: cx - (cx - g.start.x) * k + (mx - g.mx), y: cy - (cy - g.start.y) * k + (my - g.my) }, false)
      return
    }

    if (g.type === 'drag') {
      const dx = e.clientX - g.x0
      const dy = e.clientY - g.y0
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true
      if (view.current.s > 1.01 || g.start.s > 1.01) apply({ s: g.start.s, x: g.start.x + dx, y: g.start.y + dy }, false)
    }
  }

  function onPointerUp(e) {
    const g = gesture.current
    pointers.current.delete(e.pointerId)

    if (g?.type === 'pinch') {
      // One finger left after a pinch carries on as a drag from here.
      const rest = [...pointers.current.values()][0]
      gesture.current = rest ? { type: 'drag', x0: rest.x, y0: rest.y, start: { ...view.current }, moved: true } : null
      if (view.current.s < 1.05) apply({ s: 1, x: 0, y: 0 }, true)
      return
    }
    gesture.current = null
    if (!g || g.type !== 'drag') return

    const dx = e.clientX - g.x0

    // Not zoomed: a sideways swipe changes photo.
    if (g.start.s <= 1.01 && n > 1 && Math.abs(dx) > 50) {
      go(dx < 0 ? 1 : -1)
      return
    }
    if (g.moved) return

    if (e.pointerType === 'mouse') {
      // A click on the photo zooms in there, or back out.
      if (g.onImg) toggleAt(e.clientX, e.clientY)
      else if (view.current.s <= 1.01) onClose()
      return
    }

    // Touch: a double-tap zooms in there, or back out; a single tap on the
    // dark around the photo closes it.
    const now = Date.now()
    const last = lastTap.current
    if (now - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
      lastTap.current = { t: 0, x: 0, y: 0 }
      toggleAt(e.clientX, e.clientY)
    } else {
      lastTap.current = { t: now, x: e.clientX, y: e.clientY }
      if (!g.onImg && view.current.s <= 1.01) {
        setTimeout(() => { if (lastTap.current.t === now) onClose() }, 300)
      }
    }
  }

  // The wheel (and a trackpad's pinch, which arrives as ctrl + wheel) zooms
  // towards the pointer. A listener of its own so it can stop the browser
  // zooming the whole page instead — React's wheel listener can't.
  const wheel = useRef(null)
  wheel.current = (e) => {
    e.preventDefault()
    const speed = e.ctrlKey ? 0.01 : 0.0022
    zoomAt(view.current.s * Math.exp(-e.deltaY * speed), e.clientX, e.clientY, true)
  }
  const boxRef = useRef(null)
  useEffect(() => {
    const box = boxRef.current
    const on = (e) => wheel.current(e)
    box.addEventListener('wheel', on, { passive: false })
    return () => box.removeEventListener('wheel', on)
  }, [])

  return createPortal(
    <div
      ref={boxRef}
      className={`lbx ${zoomed ? 'zoomed' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      data-lenis-prevent
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => { pointers.current.delete(e.pointerId); gesture.current = null }}
    >
      <img
        ref={imgRef}
        key={i}
        className="lbx-img"
        src={imgUrl(images[i], { original: true })}
        alt={alt ? `${alt} — view ${i + 1}` : ''}
        draggable="false"
      />

      <button type="button" className="lbx-close mono" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={onClose} aria-label="Close">✕</button>

      {n > 1 && (
        <>
          <button type="button" className="lbx-nav prev" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => go(-1)} aria-label="Previous photo">‹</button>
          <button type="button" className="lbx-nav next" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => go(1)} aria-label="Next photo">›</button>
          <span className="lbx-count mono">{i + 1} / {n}</span>
        </>
      )}

      <span className={`lbx-hint mono ${zoomed ? 'gone' : ''}`}>
        <span className="lbx-hint-touch">Pinch or double-tap to zoom</span>
        <span className="lbx-hint-mouse">Scroll or click to zoom</span>
      </span>
    </div>,
    document.body
  )
}
