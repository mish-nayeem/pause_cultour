import { supabase } from './supabaseClient.js'
import { fetchLiveSales, applySale } from './sales.js'

// Maps a `products` table row (snake_case, DB-native fields) to the shape
// the UI components expect (camelCase, matching the old dummy data file).
function mapRow(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    variant: row.variant,
    price: row.price,
    drop: row.drop_name,
    category: row.category || '',
    isNew: row.is_new,
    featured: row.featured,
    images: row.images || [],
    description: row.description,
    sizes: row.sizes || [],
    sizesOut: row.sizes_out || [],
    stock: row.stock || null,
    details: row.details || '',
    sizeChart: row.size_chart || null,
    colourGroup: row.colour_group || '',
    shopPosition: row.shop_position ?? null,
    createdAt: row.created_at,
  }
}

// The shop's ALL page order. Products the admin hasn't placed yet (just
// uploaded) come first, newest first; then the admin's own order from
// Products → Product catalog. Works on both the shop's and the admin's rows.
export function queueOrder(list) {
  const pos = (p) => p.shopPosition ?? p.shop_position ?? null
  const made = (p) => new Date(p.createdAt ?? p.created_at ?? 0).getTime()
  return [...list].sort((a, b) => {
    const pa = pos(a)
    const pb = pos(b)
    if (pa == null && pb == null) return made(b) - made(a)
    if (pa == null) return -1
    if (pb == null) return 1
    return pa - pb
  })
}

// Whether two products are colours of the same piece: the same name, any
// case — same name, same piece.
export function samePiece(a, b) {
  const na = (a.name || '').trim().toLowerCase()
  return Boolean(na) && na === (b.name || '').trim().toLowerCase()
}

// One card per piece. The colours of a piece (same name) show as a single
// card: its lead — the colour added first, with Add product — and the rest
// are picked on the product page. If the lead has nothing left to buy and
// another colour has, that one stands in for it.
export function oneColourEach(list, inStock = () => true) {
  const made = (p) => new Date(p.createdAt ?? p.created_at ?? 0).getTime()
  const pick = new Map()
  for (const p of list) {
    const key = (p.name || '').trim().toLowerCase() || `#${p.id}`
    const cur = pick.get(key)
    if (!cur) { pick.set(key, p); continue }
    const better = inStock(p) !== inStock(cur) ? inStock(p) : made(p) < made(cur) || (made(p) === made(cur) && String(p.id) < String(cur.id))
    if (better) pick.set(key, p)
  }
  const chosen = new Set(pick.values())
  return list.filter((p) => chosen.has(p))
}

// The photos a card slides through on hover: the product's own, so the
// card shows that colour only — the other colours are on the product page.
export function cardPhotos(product) {
  return (product.images || []).filter(Boolean)
}

// Admin: saves the ALL page order — ids top to bottom.
export async function saveQueueOrder(ids) {
  const { error } = await supabase.rpc('reorder_products', { ids })
  if (error) console.error('[Supabase] reorder_products failed:', error.message)
  return { error }
}

// The same piece in its other colours. Each colour is its own product row;
// the colours of a piece are every product with the same name (any case).
// The old hand-typed colour group isn't used: a placeholder typed into it
// (e.g. XXX) could tie unrelated products together.
export async function fetchColourOptions(name) {
  if (!name || !name.trim()) return { options: [], error: null }

  const { data, error } = await supabase
    .from('products')
    .select('id, name, variant, images')
    .ilike('name', name.trim().replace(/[\\%_]/g, (m) => '\\' + m))
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchColourOptions failed:', error.message)
    return { options: [], error }
  }

  return { options: data, error: null }
}

// Both fetchers hand back products at today's price: a running sale is
// already taken off `price`, with the shelf price kept as `originalPrice`.
// Newest first, so a product just uploaded leads the shop.
export async function fetchProducts() {
  const [{ data, error }, sales] = await Promise.all([
    supabase.from('products').select('*').order('created_at', { ascending: false }),
    fetchLiveSales(),
  ])

  if (error) {
    console.error('[Supabase] fetchProducts failed:', error.message)
    return { products: [], error }
  }

  return { products: data.map((row) => applySale(mapRow(row), sales)), error: null }
}

export async function fetchProductById(id) {
  const [{ data, error }, sales] = await Promise.all([
    supabase.from('products').select('*').eq('id', id).single(),
    fetchLiveSales(),
  ])

  if (error) {
    console.error('[Supabase] fetchProductById failed:', error.message)
    return { product: null, error }
  }

  return { product: applySale(mapRow(data), sales), error: null }
}

// Today's price for each of these products ({ id: price }) — for a cart
// saved earlier, when a sale may have started or ended since. Products that
// no longer exist are left out.
export async function fetchCurrentPrices(ids) {
  if (!ids.length) return {}

  const [{ data, error }, sales] = await Promise.all([
    supabase.from('products').select('id, price, drop_name').in('id', ids),
    fetchLiveSales(),
  ])

  if (error) {
    console.error('[Supabase] fetchCurrentPrices failed:', error.message)
    return null
  }

  const prices = {}
  for (const row of data) {
    prices[row.id] = applySale({ id: row.id, price: row.price, drop: row.drop_name }, sales).price
  }
  return prices
}
