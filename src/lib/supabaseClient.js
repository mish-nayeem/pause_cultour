import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Loud warning during dev instead of a silent failure at checkout time.
  console.warn(
    '[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. ' +
    'Copy .env.example to .env and fill in your project values.'
  )
}

// The tables the storefront shows. A change to one of them from the admin
// panel is announced to every open shop tab (liveSite.js), which then shows
// it without a reload.
const SHOP_TABLES = /\/rest\/v1\/(products|site_settings|hero_slides|nav_categories|lookbook_looks|about_blocks|sales|product_reviews)\b/

async function watchedFetch(input, init) {
  const res = await fetch(input, init)
  try {
    const method = (init?.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : input.url
    if (res.ok && method !== 'GET' && method !== 'HEAD' && SHOP_TABLES.test(url) && window.location.pathname.startsWith('/admin')) {
      window.dispatchEvent(new CustomEvent('pause:shop-changed'))
    }
  } catch { /* never let the watch break a request */ }
  return res
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: watchedFetch } })
