// Cloudflare Worker: the Cloudflare-side equivalent of the old Vercel Edge
// middleware.js. Only invoked for /product/* (see wrangler.jsonc's
// assets.run_worker_first) — every other path skips this file entirely and
// is served straight out of the static assets, exactly like before.
//
// Facebook, WhatsApp, Messenger and friends don't run a page's JavaScript —
// they read the raw HTML once and use whatever <meta> tags are already
// there. For a client-rendered product page that's always the same generic
// tags from index.html (see src/lib/usePageMeta.js), so every product looks
// identical when it's shared. This intercepts just those crawlers and hands
// back a bare page carrying that product's own title, description and
// photo. A real visitor's request never matches BOT_PATTERN and falls
// through to env.ASSETS.fetch(request) — the normal built app, untouched.

const CLOUDINARY_MARKER = '/image/upload/'

// Facebook's own recommended share-image size (1.91:1). WhatsApp in
// particular renders more reliably when og:image:width/height are declared
// and actually match the file, which a plain resize can't promise — c_fill
// crops to the exact box instead, so the numbers below are always true.
const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630

function ogImage(url) {
  if (typeof url !== 'string' || !url.includes(CLOUDINARY_MARKER)) return url

  const [base, rest] = url.split(CLOUDINARY_MARKER)
  const alreadyTransformed = /^[a-z]{1,3}_[^/]+\//.test(rest)
  if (alreadyTransformed) return url

  return `${base}${CLOUDINARY_MARKER}f_auto,q_auto,c_fill,g_auto,w_${OG_IMAGE_WIDTH},h_${OG_IMAGE_HEIGHT}/${rest}`
}

const BOT_PATTERN =
  /facebookexternalhit|Facebot|facebookcatalog|meta-externalagent|Messenger|WhatsApp|Twitterbot|LinkedInBot|TelegramBot|Slackbot|Discordbot|Pinterest/i

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// TEMPORARY — proves whether this Worker actually runs for a given request
// and, if it falls through to the static build, why. Stamped onto every
// response as x-worker-debug. Remove once /product/* previews are confirmed
// working from a real bot request.
async function fallthrough(request, env, reason) {
  const res = await env.ASSETS.fetch(request)
  const headers = new Headers(res.headers)
  headers.set('x-worker-debug', reason)
  return new Response(res.body, { status: res.status, headers })
}

export default {
  async fetch(request, env) {
    const userAgent = request.headers.get('user-agent') || ''
    if (!BOT_PATTERN.test(userAgent)) return fallthrough(request, env, 'not-a-bot')

    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname.split('/').pop())

    // Same "Variables and secrets" the built app already reads at build
    // time (Settings → Builds) — this Worker reads them again at request
    // time, since it's a separate script, never bundled by Vite.
    const supabaseUrl = env.VITE_SUPABASE_URL
    const supabaseKey = env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) return fallthrough(request, env, 'missing-env')

    const res = await fetch(
      `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=name,variant,description,price,images`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    )
    if (!res.ok) return fallthrough(request, env, `supabase-failed-${res.status}`)

    const [product] = await res.json()
    if (!product) return fallthrough(request, env, 'product-not-found')

    const title = `${product.name} — PAUSE`
    const description = `${product.name} — ${product.variant}, ৳${Number(product.price).toLocaleString()}. ${product.description || ''}`.trim()
    const image = product.images?.[0] ? ogImage(product.images[0]) : `${url.origin}/og-image.jpg`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="product" />
<meta property="og:site_name" content="PAUSE" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />
<meta property="og:url" content="${escapeHtml(url.toString())}" />
<meta property="product:price:amount" content="${escapeHtml(product.price)}" />
<meta property="product:price:currency" content="BDT" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
</head>
<body></body>
</html>`

    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-worker-debug': 'served-og' },
    })
  },
}
