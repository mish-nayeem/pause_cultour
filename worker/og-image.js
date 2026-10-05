// The share-preview crop for a product photo, used by the Worker's crawler
// page (worker/index.js) and warmed once per deploy by
// scripts/generate-sitemap.mjs — one copy so the two always ask for the
// exact same URL.
//
// Facebook's own recommended share-image size (1.91:1). WhatsApp in
// particular renders more reliably when og:image:width/height are declared
// and actually match the file, which a plain resize can't promise — the crop
// fills the exact box instead, so the numbers are always true.
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630

const SUPABASE_OBJECT = '/storage/v1/object/public/'
const SUPABASE_RENDER = '/storage/v1/render/image/public/'
const CLOUDINARY_MARKER = '/image/upload/'

export function ogImage(url) {
  if (typeof url !== 'string') return url

  if (url.includes(SUPABASE_OBJECT) && !url.includes('?')) {
    return (
      url.replace(SUPABASE_OBJECT, SUPABASE_RENDER) +
      `?width=${OG_IMAGE_WIDTH}&height=${OG_IMAGE_HEIGHT}&resize=cover&quality=80`
    )
  }

  // Not yet moved off Cloudinary.
  if (url.includes(CLOUDINARY_MARKER)) {
    const [base, rest] = url.split(CLOUDINARY_MARKER)
    if (/^[a-z]{1,3}_[^/]+\//.test(rest)) return url
    return `${base}${CLOUDINARY_MARKER}f_auto,q_auto,c_fill,g_auto,w_${OG_IMAGE_WIDTH},h_${OG_IMAGE_HEIGHT}/${rest}`
  }

  return url
}
