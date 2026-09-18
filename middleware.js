import { next } from '@vercel/edge'

// Builds the Cloudinary transform by hand rather than importing
// src/lib/cloudinary.js — that file's upload half reads
// import.meta.env.VITE_CLOUDINARY_CLOUD_NAME at the top level, which Vite
// injects at build time but the Edge runtime never provides. Importing it
// here threw on every single invocation, bot or not, which is why every
// product page was coming back as a 500.
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

// Facebook, WhatsApp, Messenger and friends don't run a page's JavaScript —
// they read the raw HTML once and use whatever <meta> tags are already there.
// For a client-rendered product page that's always the same generic tags
// from index.html (see the comment in src/lib/usePageMeta.js), so every
// product looks identical when it's shared. This intercepts just those
// crawlers on /product/:id and hands back a bare page carrying that
// product's own title, description and photo. A real visitor's request never
// matches and reaches the normal React app untouched.
const BOT_PATTERN =
  /facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|TelegramBot|Slackbot|Discordbot|Pinterest/i

export const config = {
  matcher: '/product/:id',
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default async function middleware(request) {
  const userAgent = request.headers.get('user-agent') || ''
  if (!BOT_PATTERN.test(userAgent)) return next()

  const url = new URL(request.url)
  const id = decodeURIComponent(url.pathname.split('/').pop())

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return next()

  const res = await fetch(
    `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=name,variant,description,price,images`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  )
  if (!res.ok) return next()

  const [product] = await res.json()
  if (!product) return next()

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
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
