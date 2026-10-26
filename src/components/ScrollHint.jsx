import { useCallback, useEffect, useRef, useState } from 'react'

// A sideways-scrolling box with a light line under it whose darker part
// shows how much is on screen and where — so it's plain there's more to
// swipe. The line only appears when the content doesn't fit.
export default function ScrollHint({ className = '', children }) {
  const ref = useRef(null)
  const [track, setTrack] = useState(null) // { w, x } in %, or null when it all fits
  const measure = useCallback(() => {
    const el = ref.current
    if (!el || el.scrollWidth <= el.clientWidth + 2) return setTrack(null)
    setTrack({ w: (el.clientWidth / el.scrollWidth) * 100, x: (el.scrollLeft / el.scrollWidth) * 100 })
  }, [])

  useEffect(() => {
    measure()
    const ro = 'ResizeObserver' in window ? new ResizeObserver(measure) : null
    if (ro && ref.current) ro.observe(ref.current)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [measure])

  return (
    <>
      <div className={className} ref={ref} onScroll={measure}>{children}</div>
      {track && (
        <div className="scroll-hint" aria-hidden="true">
          <i style={{ width: `${track.w}%`, left: `${track.x}%` }} />
        </div>
      )}
    </>
  )
}
