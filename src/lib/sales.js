import { supabase } from './supabaseClient.js'

// Timed sales (Admin → Marketing → Sales): a percent off a drop, a few
// products or the whole store until a set time. place_order charges the same
// price through public.sale_price() — keep salePrice() below in step with it.

let cached = null
let cachedAt = 0

// Sales that are switched on and haven't ended (RLS hands visitors nothing
// else; the filters matter when the admin, who can read every row, is
// browsing the shop). Kept for a minute so a shop page
// and a product page opened together share one request.
export async function fetchLiveSales() {
  if (cached && Date.now() - cachedAt < 60_000) return cached

  const { data, error } = await supabase
    .from('sales')
    .select('id, name, percent, drop_name, product_ids, starts_at, ends_at')
    .eq('active', true)
    .gt('ends_at', new Date().toISOString())

  // A missing table (migration not run yet) or a dropped request just means
  // no sale — the shop still shows the normal prices.
  if (error) {
    console.error('[Supabase] fetchLiveSales failed:', error.message)
    return []
  }

  cached = data || []
  cachedAt = Date.now()
  return cached
}

function covers(sale, product) {
  const ids = sale.product_ids || []
  if (!sale.drop_name && ids.length === 0) return true
  if (sale.drop_name && sale.drop_name === product.drop) return true
  return ids.includes(String(product.id))
}

// The running sale on this product, the biggest one if several cover it.
export function saleFor(product, sales, now = Date.now()) {
  let best = null
  for (const s of sales || []) {
    if (new Date(s.starts_at).getTime() > now || new Date(s.ends_at).getTime() <= now) continue
    if (!covers(s, product)) continue
    if (!best || s.percent > best.percent) best = s
  }
  return best
}

// Same rounding as the SQL round(): to the nearest taka, halves up.
export function salePrice(price, percent) {
  return Math.round((Number(price) * (100 - percent)) / 100)
}

// The product as the shop sells it right now: `price` is what goes in the
// cart, `originalPrice` and `sale` are there to show the saving.
export function applySale(product, sales) {
  const s = saleFor(product, sales)
  if (!s) return product
  return {
    ...product,
    price: salePrice(product.price, s.percent),
    originalPrice: product.price,
    sale: { percent: s.percent, endsAt: s.ends_at, name: s.name },
  }
}

// "2d 04h" / "04:12:33" — what's left of a sale.
export function timeLeft(endsAt, now = Date.now()) {
  const ms = new Date(endsAt).getTime() - now
  if (ms <= 0) return null
  const sec = Math.floor(ms / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n) => String(n).padStart(2, '0')
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function listSales() {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .order('created_at', { ascending: false })
  return { sales: data || [], error }
}

export async function createSale(sale) {
  cached = null
  const { error } = await supabase.from('sales').insert(sale)
  return { error }
}

export async function setSaleActive(id, active) {
  cached = null
  const { error } = await supabase.from('sales').update({ active }).eq('id', id)
  return { error }
}

export async function deleteSale(id) {
  cached = null
  const { error } = await supabase.from('sales').delete().eq('id', id)
  return { error }
}
