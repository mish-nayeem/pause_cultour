import { useEffect, useState } from 'react'

function two(n) {
  return String(n).padStart(2, '0')
}

// "2D 04:12:09" to a time; gone once the time has passed.
export function useCountdown(at) {
  const target = at ? new Date(at).getTime() : 0
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!target || target <= Date.now()) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [target])
  const left = Math.max(0, target - now)
  if (!target || left <= 0) return null
  const s = Math.floor(left / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${d ? `${d}D ` : ''}${two(h)}:${two(m)}:${two(s % 60)}`
}

// The homepage's drop countdown: a line of text and the time left, shown
// only while the time is still ahead. Admin → Homepage → Drop countdown.
export default function DropCountdown({ countdown, className = '' }) {
  const left = useCountdown(countdown?.at)
  if (!left) return null
  return (
    <div className={`drop-count mono ${className}`} aria-live="off">
      <span className="drop-count-label">{(countdown.label || 'NEXT DROP').toUpperCase()}</span>
      <span className="drop-count-time">{left}</span>
    </div>
  )
}
