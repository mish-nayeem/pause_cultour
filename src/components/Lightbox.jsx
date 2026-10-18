import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { imgUrl } from '../lib/images.js'
import './lightbox.css'

// A product photo full screen. ‹ › or a swipe for the others, ✕ / Esc or a
// tap on the dark around it to close.
export default function Lightbox({ images, start = 0, alt = '', onClose }) {
  const [i, setI] = useState(start)
  const downX = useRef(null)
  const n = images.length
  const go = (d) => setI((v) => (v + d + n) % n)

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

  return createPortal(
    <div
      className="lbx"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      data-lenis-prevent
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onPointerDown={(e) => { downX.current = e.clientX }}
      onPointerUp={(e) => {
        if (downX.current == null || n < 2) return
        const dx = e.clientX - downX.current
        downX.current = null
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
      }}
    >
      <img
        className="lbx-img"
        src={imgUrl(images[i], { w: 2500, q: 90 })}
        alt={alt ? `${alt} — view ${i + 1}` : ''}
        draggable="false"
      />

      <button type="button" className="lbx-close mono" onClick={onClose} aria-label="Close">✕</button>

      {n > 1 && (
        <>
          <button type="button" className="lbx-nav prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
          <button type="button" className="lbx-nav next" onClick={() => go(1)} aria-label="Next photo">›</button>
          <span className="lbx-count mono">{i + 1} / {n}</span>
        </>
      )}
    </div>,
    document.body
  )
}
