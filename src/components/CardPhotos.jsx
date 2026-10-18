import { useEffect, useRef, useState } from 'react'
import { imgUrl } from '../lib/images.js'
import ShimmerImage from './ShimmerImage.jsx'

// A product card's photos on a phone: tap the photo for the next one, tap
// again for the one after (back to the first at the end). Tapping the name
// or price still opens the product; with a mouse, clicking the photo opens
// it as before. Spread `thumbProps` on the photo's box.
export function useCardPhotos(images, width = 500) {
  const list = Array.isArray(images) ? images.filter(Boolean) : []
  const count = list.length
  const [index, setIndex] = useState(0)
  // Where and when a finger went down, to tell a tap from a scroll.
  const touch = useRef(null)
  // A tap already moved the photo on; the click the browser sends after it
  // must not open the product.
  const swallowClick = useRef(false)

  // The next photo starts loading as soon as this one shows, so a tap
  // swaps straight away instead of waiting on the network.
  useEffect(() => {
    if (count < 2) return
    const next = new Image()
    next.src = imgUrl(list[(index + 1) % count], { w: width })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count])

  // The tap is read when the finger lifts, not from the click: iPhone
  // Safari can spend a first tap on hover and never send a click at all.
  const thumbProps = count > 1
    ? {
        onPointerDown: (e) => {
          touch.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY, t: Date.now() }
        },
        onPointerUp: (e) => {
          const t = touch.current
          touch.current = null
          if (!t) return
          const moved = Math.hypot(e.clientX - t.x, e.clientY - t.y)
          if (moved > 10 || Date.now() - t.t > 600) return
          swallowClick.current = true
          setTimeout(() => { swallowClick.current = false }, 800)
          setIndex((i) => (i + 1) % count)
        },
        // Scrolling took over the touch: not a tap.
        onPointerCancel: () => { touch.current = null },
        onClick: (e) => {
          if (!swallowClick.current) return
          swallowClick.current = false
          e.preventDefault()
          e.stopPropagation()
        },
      }
    : {}

  return { src: imgUrl(list[Math.min(index, Math.max(count - 1, 0))], { w: width }), index, count, thumbProps }
}

// Small dots along the photo's bottom edge: how many photos, which one.
export function PhotoDots({ index, count }) {
  if (count < 2) return null
  return (
    <span className="card-dots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <i key={i} className={i === index ? 'on' : ''} />)}
    </span>
  )
}

// The photo (and its dots) for a shop card — drop-in for the card's <img>.
export function CardPhoto({ images, alt, width = 500, loading }) {
  const { src, index, count, thumbProps } = useCardPhotos(images, width)
  return (
    <>
      <ShimmerImage src={src} alt={alt} loading={loading} {...thumbProps} />
      <PhotoDots index={index} count={count} />
    </>
  )
}
