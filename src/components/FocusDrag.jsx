import { useRef, useState } from 'react'
import './focus-drag.css'

// The old arrow choices, read as positions so a photo saved with one opens
// where it was.
const WORDS = {
  center: [50, 50],
  top: [50, 0],
  bottom: [50, 100],
  left: [0, 50],
  right: [100, 50],
}

export function parseFocus(value) {
  if (!value) return [50, 50]
  if (WORDS[value]) return WORDS[value]
  const m = String(value).match(/^(-?[\d.]+)%\s+(-?[\d.]+)%$/)
  return m ? [Number(m[1]), Number(m[2])] : [50, 50]
}

const clamp = (n) => Math.min(100, Math.max(0, n))

// A photo in the shape of the screen it's for, moved the way a Facebook
// cover is: press and drag it until the part you want sits in the frame,
// then let go. Saved as the photo's focus ("x% y%"), which the site uses as
// its object-position.
export default function FocusDrag({ src, value, disabled = false, className = '', onChange, children }) {
  const frame = useRef(null)
  const img = useRef(null)
  const start = useRef(null)
  const [live, setLive] = useState(null)
  const [x, y] = live || parseFocus(value)

  function down(e) {
    if (disabled || !img.current?.naturalWidth) return
    const f = frame.current.getBoundingClientRect()
    const { naturalWidth: nw, naturalHeight: nh } = img.current
    // object-fit: cover — the photo is scaled until it covers the frame, and
    // whatever spills over one side is what dragging can bring into view.
    const scale = Math.max(f.width / nw, f.height / nh)
    start.current = {
      px: e.clientX,
      py: e.clientY,
      x,
      y,
      spillX: nw * scale - f.width,
      spillY: nh * scale - f.height,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setLive([x, y])
  }

  function move(e) {
    const s = start.current
    if (!s) return
    // Dragging right shows more of the left, so the position goes down.
    const nx = s.spillX > 0.5 ? clamp(s.x - ((e.clientX - s.px) / s.spillX) * 100) : s.x
    const ny = s.spillY > 0.5 ? clamp(s.y - ((e.clientY - s.py) / s.spillY) * 100) : s.y
    setLive([nx, ny])
  }

  function up() {
    const s = start.current
    start.current = null
    if (!s || !live) return setLive(null)
    const [nx, ny] = live.map((n) => Math.round(n))
    setLive(null)
    if (nx !== Math.round(s.x) || ny !== Math.round(s.y)) onChange(`${nx}% ${ny}%`)
  }

  return (
    <div
      ref={frame}
      className={`focus-drag ${live ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${className}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <img ref={img} src={src} alt="" draggable={false} style={{ objectPosition: `${x}% ${y}%` }} />
      {!disabled && <span className="focus-drag-hint mono">{live ? 'Let go to save' : '✥ Drag to move'}</span>}
      {children}
    </div>
  )
}
