import { next } from '@vercel/edge'
import { cld } from './src/lib/cloudinary.js'

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
  const image = product.images?.[0] ? cld(product.images[0], { w: 1200 }) : `${url.origin}/og-image.jpg`

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
