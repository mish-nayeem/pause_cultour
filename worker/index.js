// Cloudflare Worker. Runs for every page (not the hashed /assets/* files —
// see wrangler.jsonc's assets.run_worker_first) and does two jobs:
//
// 1. Share previews for product links. Facebook, WhatsApp, Instagram,
//    Messenger and friends don't run a page's JavaScript — they read the raw
//    HTML once and use whatever <meta> tags are already there. For a
//    client-rendered product page that's always the same generic tags from
//    index.html, so every product would look identical when shared. Those
//    crawlers get a bare page carrying the product's own title, description
//    and photo instead (no price — the preview leaves that to the page).
//    A real visitor never matches BOT_PATTERN.
//
// 2. The site's own address. index.html, robots.txt and sitemap.xml are
//    written with SITE_PLACEHOLDER; every response swaps it for whatever
//    domain the request actually came in on. So a shared home-page link
//    shows this domain and loads its picture from here, and moving to a
//    custom domain later needs no code change at all.

import { withSecurityHeaders } from './security-headers.js'

import { ogImage, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT } from './og-image.js'

const BOT_PATTERN =
  /facebookexternalhit|Facebot|facebookcatalog|meta-externalagent|Messenger|WhatsApp|Instagram|Twitterbot|LinkedInBot|TelegramBot|Slackbot|Discordbot|Pinterest|Viber|SkypeUriPreview|Snapchat/i

// The address index.html, robots.txt and the sitemap are written with.
const SITE_PLACEHOLDER = 'https://pause-cultour.vercel.app'

// Only text files carry the placeholder; photos and fonts pass straight through.
const TEXT_TYPES = /text\/html|text\/plain|xml/

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default {
  // Every response, the crawler page and the passed-through app alike, leaves
  // with the same security headers the static files get from _headers.
  async fetch(request, env) {
    return withSecurityHeaders(await handle(request, env))
  },
}

async function handle(request, env) {
  const url = new URL(request.url)
  const userAgent = request.headers.get('user-agent') || ''

  if (url.pathname.startsWith('/product/') && BOT_PATTERN.test(userAgent)) {
    const card = await productCard(url, env)
    if (card) return card
  }

  return withOwnOrigin(await env.ASSETS.fetch(request), url.origin)
}

async function withOwnOrigin(res, origin) {
  if (res.status !== 200 || !TEXT_TYPES.test(res.headers.get('content-type') || '')) return res
  if (origin === SITE_PLACEHOLDER) return res

  const body = (await res.text()).replaceAll(SITE_PLACEHOLDER, origin)
  return new Response(body, res)
}

// null when anything is missing, so the caller falls back to the normal page.
async function productCard(url, env) {
  const id = decodeURIComponent(url.pathname.split('/').pop())

  // Set in wrangler.jsonc's "vars" — this Worker's own runtime env, read
  // again here since it's a separate script the Vite build never bundles.
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return null

  const res = await fetch(
    `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=name,variant,description,images`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  )
  if (!res.ok) return null

  const [product] = await res.json()
  if (!product) return null

  const title = `${product.name} — PAUSE`
  // Previews show two lines or so; a long description just gets cut off
  // mid-word by the app instead.
  // No price here: a shared link is an invitation to look, not a price tag.
  const fullDescription = `${product.name} — ${product.variant}. ${product.description || ''}`.trim()
  const description = fullDescription.length > 200 ? fullDescription.slice(0, 197).trimEnd() + '…' : fullDescription
  const image = product.images?.[0] ? ogImage(product.images[0]) : `${url.origin}/og-image.jpg`
  // Without the ?utm_source=share the link was sent with, so every share of
  // one product is cached by WhatsApp/Facebook as the same page.
  const pageUrl = url.origin + url.pathname

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<link rel="canonical" href="${escapeHtml(pageUrl)}" />
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="product" />
<meta property="og:site_name" content="PAUSE" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:image:secure_url" content="${escapeHtml(image)}" />
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />
<meta property="og:image:alt" content="${escapeHtml(title)}" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
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
