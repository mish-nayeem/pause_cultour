import { supabase } from './supabaseClient.js'
import { IMAGE_BUCKET } from './images.js'

// Each product's link-preview picture, made ahead of time: a 1200×630 JPEG
// (~100 KB) at images/og/<id>.jpg. Made the moment a product is saved, and
// for any product still without one when the admin panel loads its list.
// worker/index.js points a shared link's og:image at it, so WhatsApp and
// Facebook get a small, ready file straight off the CDN — before, the photo
// was resized on the spot on the first share and often came too late, and
// the preview went out without a picture.

const W = 1200
const H = 630

export const shareImagePath = (id) => `og/${id}.jpg`

async function loadImage(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`photo ${res.status}`)
  const blob = await res.blob()
  if ('createImageBitmap' in window) return createImageBitmap(blob)
  const img = new Image()
  img.src = URL.createObjectURL(blob)
  await img.decode()
  return img
}

// Fills the 1.91:1 box from the photo, kept to its upper part — where a
// model's face and the print usually are — rather than the dead centre.
async function render(url) {
  const img = await loadImage(url)
  const iw = img.width
  const ih = img.height
  const scale = Math.max(W / iw, H / ih)
  const sw = W / scale
  const sh = H / scale
  const sx = (iw - sw) / 2
  const sy = Math.min(Math.max(0, ih * 0.32 - sh / 2), ih - sh)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, W, H)
  g.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.82))
}

// Never throws: a preview picture is a nicety, a save must not fail over it.
export async function makeShareImage(id, photoUrl) {
  if (!id || !photoUrl) return false
  try {
    const blob = await render(photoUrl)
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(shareImagePath(id), blob, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: true,
    })
    if (error) throw new Error(error.message)
    return true
  } catch (e) {
    console.warn('[shareImage]', id, e.message)
    return false
  }
}

let checked = false

// Once per visit to the admin: every product with a photo but no preview
// picture yet gets one, quietly, one at a time.
export async function fillMissingShareImages(products) {
  if (checked || !products?.length) return
  checked = true
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).list('og', { limit: 1000 })
  if (error) return
  const have = new Set((data || []).map((f) => f.name))
  for (const p of products) {
    const photo = Array.isArray(p.images) ? p.images[0] : null
    if (photo && !have.has(`${p.id}.jpg`)) await makeShareImage(p.id, photo)
  }
}
