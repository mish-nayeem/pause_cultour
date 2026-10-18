// Product, hero and about-page photos live in Supabase Storage (the public
// `images` bucket — see supabase-migration-image-storage.sql). This file
// does the two things the rest of the app needs from it:
//
// imgUrl() — asks for roughly the size an <img> actually renders. A phone
//   photo is several MB; serving that into a 260px grid tile wastes nearly
//   all of it. Supabase's image transformation endpoint resizes on the fly,
//   serves WebP to browsers that take it, and caches the result on its CDN.
//
// uploadImage() — the admin panel's upload, straight from the browser into
//   the bucket. Only the signed-in admin can write there (storage policies
//   check public.is_admin()), so no signing step or secret is involved.
//
// Old Cloudinary links still work until the admin panel's "Move images to
// Supabase" button has copied them over; anything else (a placeholder URL,
// say) passes through untouched.

export const IMAGE_BUCKET = 'images'

const SUPABASE_OBJECT = '/storage/v1/object/public/'
const SUPABASE_RENDER = '/storage/v1/render/image/public/'
const CLOUDINARY_MARKER = '/image/upload/'

export function imgUrl(url, { w, h, q, original = false } = {}) {
  if (typeof url !== 'string') return url

  // The stored file itself, untouched — for the full-screen view, where a
  // second resize and re-encode would soften what was uploaded.
  if (original) return url

  if (url.includes(SUPABASE_OBJECT)) {
    // A URL that already carries its own query was set up by hand — leave it.
    if (url.includes('?')) return url

    // 75 keeps grid tiles light; a full-screen view asks for more (q).
    const params = new URLSearchParams({ quality: String(q || 75) })
    if (w) params.set('width', String(w))
    if (h) params.set('height', String(h))
    // With both sides set, fill the box and crop the overflow — the same
    // thing object-fit: cover would do in the browser. With one side only,
    // `contain`: Supabase's default is `cover`, which with a width alone
    // keeps the photo's full height and cuts a narrow strip out of the
    // middle — the grid then blew that strip up, so every tile looked
    // zoomed in. `contain` just scales the whole photo down, the way
    // Cloudinary's c_limit did.
    params.set('resize', w && h ? 'cover' : 'contain')

    return url.replace(SUPABASE_OBJECT, SUPABASE_RENDER) + '?' + params
  }

  if (url.includes(CLOUDINARY_MARKER)) {
    const [base, rest] = url.split(CLOUDINARY_MARKER)
    // Already transformed in the DB — an explicit crop there should win.
    if (/^[a-z]{1,3}_[^/]+\//.test(rest)) return url

    const parts = ['f_auto', 'q_auto', 'c_limit']
    if (w) parts.push(`w_${w}`)
    if (h) parts.push(`h_${h}`)
    return `${base}${CLOUDINARY_MARKER}${parts.join(',')}/${rest}`
  }

  return url
}

// ---------- Upload ----------

// Photos are shrunk in the browser before they go up: a camera original can
// be 20–50 MB and 8000 px wide, which the bucket refuses (20 MB a file) and
// Supabase's resizer won't take as a source either. 3600 px on the long side
// at 92% leaves headroom over the largest view the site serves (2500 px,
// Supabase's own maximum, full screen), so zooming in stays crisp — a few
// MB at most. Small photos that already fit go up untouched.
const MAX_SIDE = 3600
const QUALITY = 0.92
const KEEP_UNDER = 2.5 * 1024 * 1024

async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // a format this browser can't open — let the bucket judge it
  }

  const { width, height } = bitmap
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  if (scale === 1 && file.size <= KEEP_UNDER) {
    bitmap.close?.()
    return file
  }

  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  // PNGs may be see-through: WebP keeps that. Everything else becomes JPEG.
  const wanted = file.type === 'image/png' ? 'image/webp' : 'image/jpeg'
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, wanted, QUALITY))
  if (!blob || blob.size >= file.size) return file

  const type = blob.type || wanted
  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg'
  const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext
  return new File([blob], name, { type })
}

// `folder` only keeps the bucket tidy (products/, hero/, about/). A random
// name means two photos called IMG_0001.jpg never overwrite each other.
export async function uploadImage(original, supabase, folder = 'uploads') {
  const file = await shrink(original)
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${folder}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    // A path is never reused, so browsers and the CDN can keep it for a year.
    cacheControl: '31536000',
    upsert: false,
  })

  if (error) throw new Error(error.message)

  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
