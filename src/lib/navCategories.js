import { supabase } from './supabaseClient.js'
import { fetchProducts } from './products.js'

// One table backs both nav dropdowns; `menu` says which one a row belongs to.
// SHOP rows match a product's category, DROPS rows match its drop name.
export const SHOP_MENU = 'shop'
export const DROPS_MENU = 'drops'

// Public read — RLS only returns the visible rows, in menu order.
export async function fetchNavCategories(menu = SHOP_MENU) {
  const { data, error } = await supabase
    .from('nav_categories')
    .select('*')
    .eq('menu', menu)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchNavCategories failed:', error.message)
    return { categories: [], error }
  }

  return { categories: data, error: null }
}

// A dropdown as the storefront should render it: the admin's list once it has
// a row, and whatever the catalog itself contains until then, so a fresh
// install still has a working menu. The nav and the shop filters both read
// this, so hiding an entry takes it off every list at once.
async function resolveMenu(menu, productField) {
  const { categories } = await fetchNavCategories(menu)
  if (categories.length > 0) return categories.map((c) => c.label)

  const { products } = await fetchProducts()
  return [...new Set(products.map((p) => p[productField]).filter(Boolean))].sort()
}

export function fetchMenuCategories() {
  return resolveMenu(SHOP_MENU, 'category')
}

export function fetchMenuDrops() {
  return resolveMenu(DROPS_MENU, 'drop')
}

// Admin read — the signed-in policy returns hidden rows too, so they can be
// switched back on.
export async function fetchAllNavCategories(menu = SHOP_MENU) {
  const { data, error } = await supabase
    .from('nav_categories')
    .select('*')
    .eq('menu', menu)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchAllNavCategories failed:', error.message)
    return { categories: [], error }
  }

  return { categories: data, error: null }
}

export async function createNavCategory({ label, sortOrder, menu = SHOP_MENU }) {
  const { error } = await supabase.from('nav_categories').insert({
    label,
    sort_order: sortOrder,
    menu,
  })

  if (error) {
    console.error('[Supabase] createNavCategory failed:', error.message)
    return { error }
  }

  return { error: null }
}

export async function updateNavCategory(id, patch) {
  const { error } = await supabase.from('nav_categories').update(patch).eq('id', id)

  if (error) {
    console.error('[Supabase] updateNavCategory failed:', error.message)
    return { error }
  }

  return { error: null }
}

export async function deleteNavCategory(id) {
  const { error } = await supabase.from('nav_categories').delete().eq('id', id)

  if (error) {
    console.error('[Supabase] deleteNavCategory failed:', error.message)
    return { error }
  }

  return { error: null }
}

// Writes every row's sort_order rather than swapping two, because a partial
// failure mid-swap would leave two entries claiming the same position.
export async function reorderNavCategories(categories) {
  const updates = categories.map((c, i) =>
    supabase.from('nav_categories').update({ sort_order: i }).eq('id', c.id)
  )

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)

  if (failed) {
    console.error('[Supabase] reorderNavCategories failed:', failed.error.message)
    return { error: failed.error }
  }

  return { error: null }
}
