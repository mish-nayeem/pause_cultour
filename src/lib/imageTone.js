import { useEffect, useState } from 'react'
import { imgUrl } from './images.js'

// Whether the bottom-right corner of a photo (where the quick-add + sits) is
// light or dark, so the + can be drawn black on a light shot and white on a
// dark one. Worked out from a tiny copy of the photo; null until known, or
// if the browser won't let the pixels be read.
const cache = new Map()

function measure(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const w = img.naturalWidth
        const h = img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        // The corner the + covers: right third, bottom quarter.
        const x = Math.floor(w * 0.66)
        const y = Math.floor(h * 0.75)
        const { data } = ctx.getImageData(x, y, w - x, h - y)
        let sum = 0
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        }
        const luma = sum / (data.length / 4)
        resolve(luma > 140 ? 'light' : 'dark')
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export function useCornerTone(url) {
  const [tone, setTone] = useState(() => (url && cache.has(url) ? cache.get(url) : null))

  useEffect(() => {
    if (!url) return
    let alive = true
    let job = cache.get(url)
    if (job === undefined) {
      job = measure(imgUrl(url, { w: 60 }))
      cache.set(url, job)
    }
    Promise.resolve(job).then((t) => {
      cache.set(url, t)
      if (alive) setTone(t)
    })
    return () => { alive = false }
  }, [url])

  return tone
}
