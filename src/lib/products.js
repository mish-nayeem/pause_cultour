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
  }
}

// The same piece in its other colours. Each colour is its own product row, so
// this is a lookup by the shared group rather than a field on the product.
export async function fetchColourOptions(colourGroup) {
  if (!colourGroup) return { options: [], error: null }

  const { data, error } = await supabase
    .from('products')
    .select('id, name, variant, images')
    .eq('colour_group', colourGroup)
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
