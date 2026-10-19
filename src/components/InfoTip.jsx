import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './info-tip.css'

// An ⓘ beside a title: tapping it opens the explanation, tapping anywhere —
// the note itself included — closes it again. The note is placed so it
// always fits on the screen, however close to an edge the ⓘ sits.
export default function InfoTip({ children, label = "What's this?" }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null) // { left, width, arrow } in px, relative to the ⓘ
  const ref = useRef(null)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const width = Math.min(300, vw - 24)
    // Ideally starting a little left of the ⓘ; pulled back inside 12px of
    // either edge when that would run off the screen.
    const want = r.left - 12
    const left = Math.max(12, Math.min(want, vw - width - 12))
    setPos({ left: left - r.left, width, arrow: r.left + r.width / 2 - left })
  }, [open])

  useEffect(() => {
    if (!open) return
    function away(e) {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    function close() {
      setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <span className="itip" ref={ref}>
      <button
        type="button"
        className={`itip-btn ${open ? 'on' : ''}`}
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        i
      </button>
      {open && (
        <span
          className="itip-pop"
          role="note"
          style={pos ? { left: pos.left, width: pos.width, '--arrow': `${pos.arrow}px` } : { visibility: 'hidden' }}
          onClick={(e) => {
            e.preventDefault()
            setOpen(false)
          }}
        >
          {children}
        </span>
      )}
    </span>
  )
}
