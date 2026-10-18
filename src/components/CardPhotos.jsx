import { useEffect, useRef, useState } from 'react'
import { imgUrl } from '../lib/images.js'
import ShimmerImage from './ShimmerImage.jsx'

// How long each photo shows while the pointer rests on a card.
const STEP_MS = 1300

// A shop card's photos. Resting the mouse pointer on the photo slides
// through the product's other photos one by one; moving off slides back to
// the first. A tap or a click opens the product as always — on a phone the
// card just shows its main photo.
export function CardPhoto({ images, alt, width = 500, loading }) {
  const list = Array.isArray(images) ? images.filter(Boolean) : []
  const count = list.length
  const [index, setIndex] = useState(0)
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
    function stop() {
      clearInterval(timer.current)
      setIndex(0)
    }
    box.addEventListener('pointerenter', start)
    box.addEventListener('pointerleave', stop)
    return () => {
      clearInterval(timer.current)
      box.removeEventListener('pointerenter', start)
      box.removeEventListener('pointerleave', stop)
    }
  }, [count])

  if (count < 2) {
    return <ShimmerImage src={imgUrl(list[0], { w: width })} alt={alt} loading={loading} />
  }

  return (
    <>
      <span className="card-track" ref={track} style={{ transform: `translateX(${-index * 100}%)` }}>
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
