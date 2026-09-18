// Regenerates public/sitemap.xml with every product's URL alongside the
// static pages, right before `vite build` copies public/ into dist/. That
// means the sitemap is only as fresh as the last deploy — fine here, since a
// push to this repo is what puts a new drop live in the first place, so the
// two always land together.
//
// Also warms the Cloudinary crop that middleware.js uses for a product's
// share-preview image. Cloudinary generates a transform on its first request
// rather than ahead of time, and these source photos run several MB — the
// first fetch can take a few seconds, which is longer than WhatsApp's crawler
// waits before giving up and showing the link with no picture at all. Hitting
// every product's crop once per deploy means a crawler is never the one
// waiting on it.
//
// Runs with whatever Supabase credentials the environment has: Vercel's
// project env vars in production, or .env for a local build.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvFile() {
  if (!existsSync('.env')) return

  // Strip a leading BOM (this repo's .env has one) and normalise CRLF before
  // splitting — a bare \r left on the end of a line stops `.` from matching
  // it, which silently drops every line but the last one.
  const content = readFileSync('.env', 'utf8').replace(/^﻿/, '')

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
}

loadEnvFile()

const SITE = 'https://pause-cultour.vercel.app'

const STATIC_PAGES = [
  { path: '/', priority: '1.0' },
  { path: '/shop', priority: '0.9' },
  { path: '/size-guide', priority: '0.6' },
  { path: '/delivery', priority: '0.6' },
  { path: '/contact', priority: '0.6' },
  { path: '/privacy', priority: '0.3' },
  { path: '/terms', priority: '0.3' },
  { path: '/refunds', priority: '0.3' },
]

// Same crop middleware.js builds for the share image — kept in sync by hand
// since this runs as a plain Node script, not through Vite, and can't import
// src/lib/cloudinary.js (its upload half reads a Vite-only env global at
// module load time and throws outside a Vite build).
const CLOUDINARY_MARKER = '/image/upload/'

function ogImageUrl(url) {
  if (typeof url !== 'string' || !url.includes(CLOUDINARY_MARKER)) return null
  const [base, rest] = url.split(CLOUDINARY_MARKER)
  return `${base}${CLOUDINARY_MARKER}f_auto,q_auto,c_fill,g_auto,w_1200,h_630/${rest}`
}

async function fetchProducts() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) {
    console.warn('[sitemap] Supabase env vars missing — writing static pages only.')
    return []
  }

  const supabase = createClient(url, key)
  const { data, error } = await supabase.from('products').select('id, images')

  if (error) {
    console.error('[sitemap] Could not fetch products — writing static pages only:', error.message)
    return []
  }

  return data || []
}

async function warmShareImages(products) {
  const urls = products.map((p) => p.images?.[0]).filter(Boolean).map(ogImageUrl).filter(Boolean)

  const results = await Promise.allSettled(urls.map((u) => fetch(u)))
  const warmed = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length

  console.log(`[sitemap] Warmed ${warmed}/${urls.length} product share images.`)
}

async function main() {
  const products = await fetchProducts()
  const productPages = products.map((p) => ({
    path: `/product/${encodeURIComponent(p.id)}`,
    priority: '0.8',
  }))

  const urls = [...STATIC_PAGES, ...productPages]
    .map((u) => `  <url><loc>${SITE}${u.path}</loc><priority>${u.priority}</priority></url>`)
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`

  writeFileSync('public/sitemap.xml', xml)
  console.log(`[sitemap] Wrote ${STATIC_PAGES.length + productPages.length} URLs to public/sitemap.xml (${productPages.length} products).`)

  await warmShareImages(products)
}

main()
