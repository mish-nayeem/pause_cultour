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

export function imgUrl(url, { w, h } = {}) {
  if (typeof url !== 'string') return url

  if (url.includes(SUPABASE_OBJECT)) {
    // A URL that already carries its own query was set up by hand — leave it.
    if (url.includes('?')) return url

    const params = new URLSearchParams({ quality: '75' })
    if (w) params.set('width', String(w))
    if (h) params.set('height', String(h))
    // With both sides set, fill the box and crop the overflow — the same
    // thing object-fit: cover would do in the browser.
    if (w && h) params.set('resize', 'cover')

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

// `folder` only keeps the bucket tidy (products/, hero/, about/). A random
// name means two photos called IMG_0001.jpg never overwrite each other.
export async function uploadImage(file, supabase, folder = 'uploads') {
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
