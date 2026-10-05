import { useEffect, useRef, useState } from 'react'

// A product photo that shows a soft moving shimmer in its own box until the
// file has actually arrived, instead of an empty grey gap. The shimmer is the
// <img>'s own background (see .simg in global.css), so it fits whatever box
// the photo already sits in — no extra wrapper to keep in step with each
// page's layout.
export default function ShimmerImage({ className = '', onLoad, onError, ...props }) {
  const ref = useRef(null)
  const [loaded, setLoaded] = useState(false)

  // A photo already in the browser cache can finish before React attaches
  // onLoad, which would leave it shimmering forever — check once on mount
  // and again whenever the src changes.
  useEffect(() => {
    const img = ref.current
    setLoaded(Boolean(img?.complete && img.naturalWidth > 0))
  }, [props.src])

  return (
    <img
      ref={ref}
      {...props}
      className={`simg ${loaded ? 'is-loaded' : ''} ${className}`.trim()}
      onLoad={(e) => {
        setLoaded(true)
        onLoad?.(e)
      }}
      // A broken link stops shimmering too — a box that pulses forever reads
      // as "still coming" when nothing is.
      onError={(e) => {
        setLoaded(true)
        onError?.(e)
      }}
    />
  )
}
