// Injects Cloudinary transformations into an image URL.
//
// Why this exists: the free Cloudinary tier shares one 25-credit pool across
// storage, bandwidth and transformations, and bandwidth is by far the biggest
// draw. Serving a 900px product shot into a 260px grid thumbnail wastes most
// of the bytes, so every <img> asks for roughly the size it actually renders.
//
// f_auto  — serves WebP/AVIF to browsers that support it, JPEG to those that don't
// q_auto  — picks the lowest quality that still looks clean
// c_limit — never upscales past the original
//
// Non-Cloudinary URLs (e.g. the picsum placeholders) pass through untouched,
// so this is safe to apply everywhere while the catalog is still mixed.

const CLOUDINARY_MARKER = '/image/upload/'

export function cld(url, { w, h } = {}) {
  if (typeof url !== 'string' || !url.includes(CLOUDINARY_MARKER)) {
    return url
  }

  const parts = ['f_auto', 'q_auto', 'c_limit']
  if (w) parts.push(`w_${w}`)
  if (h) parts.push(`h_${h}`)

  const [base, rest] = url.split(CLOUDINARY_MARKER)

  // If the URL already carries a transformation segment, leave it alone rather
  // than stacking a second one — an explicit crop in the DB should win.
  const alreadyTransformed = /^[a-z]{1,3}_[^/]+\//.test(rest)
  if (alreadyTransformed) return url

  return `${base}${CLOUDINARY_MARKER}${parts.join(',')}/${rest}`
}

// ---------- Upload ----------

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME

// Uploads one file straight from the browser to Cloudinary. The signature comes
// from the sign-cloudinary-upload edge function, which only issues one to a
// signed-in admin — so the API secret stays server-side and randoms can't
// upload into the account.
export async function uploadImage(file, supabase) {
  if (!CLOUD_NAME) {
    throw new Error('VITE_CLOUDINARY_CLOUD_NAME is not set')
  }

  const { data: sig, error: sigError } = await supabase.functions.invoke(
    'sign-cloudinary-upload'
  )

  if (sigError || !sig?.signature) {
    throw new Error(sigError?.message || 'Could not get an upload signature')
  }

  const form = new FormData()
  form.append('file', file)
  form.append('api_key', sig.apiKey)
  form.append('timestamp', sig.timestamp)
  form.append('signature', sig.signature)
  form.append('folder', sig.folder)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    throw new Error(`Cloudinary ${res.status}: ${await res.text()}`)
  }

  const data = await res.json()
  return data.secure_url
}
