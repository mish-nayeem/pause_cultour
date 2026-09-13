import { supabase } from './supabaseClient.js'

// ---------- Admin allowlist ----------

// Only this email can open the admin panel. Set it in .env locally and in the
// Vercel project's Environment Variables for the deployed site.
// This check is convenience, not security — the real enforcement lives in the
// Supabase RLS policies, which reject queries from any other logged-in account
// even if someone bypasses this file. Both must name the same address.
const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').trim().toLowerCase()

export function isAdminEmail(email) {
  const candidate = (email || '').trim().toLowerCase()

  if (!ADMIN_EMAIL) {
    // Surfaces the most common cause — the env var never reached the build —
    // instead of failing with an unexplained "no access" message.
    console.error(
      '[Admin] VITE_ADMIN_EMAIL is not set. Add it to .env (and restart the dev ' +
      'server), or to the Vercel Environment Variables and redeploy.'
    )
    return false
  }

  const match = candidate === ADMIN_EMAIL

  if (!match) {
    console.warn(
      `[Admin] Email mismatch. Signed in as "${candidate}", expected "${ADMIN_EMAIL}".`
    )
  }

  return match
}

// ---------- Auth ----------

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.error('[Supabase] signIn failed:', error.message)
    return { session: null, error }
  }

  // A valid Supabase account that isn't the admin gets signed straight back out,
  // so no non-admin session is ever left sitting in local storage.
  if (!isAdminEmail(data.session?.user?.email)) {
    await supabase.auth.signOut()
    return { session: null, error: { message: 'not_admin' } }
  }

  return { session: data.session, error: null }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  const session = data.session

  // Guards against a stale or hand-crafted session for a non-admin account.
  if (session && !isAdminEmail(session.user?.email)) {
    await supabase.auth.signOut()
    return null
  }

  return session
}

// ---------- Orders ----------

export async function fetchOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[Supabase] fetchOrders failed:', error.message)
    return { orders: [], error }
  }
  return { orders: data, error: null }
}

export async function updateOrderStatus(orderId, status) {
  const { error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)

  if (error) {
    console.error('[Supabase] updateOrderStatus failed:', error.message)
    return { error }
  }
  return { error: null }
}

// ---------- Products ----------

export async function fetchAdminProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchAdminProducts failed:', error.message)
    return { products: [], error }
  }
  return { products: data, error: null }
}

// ---------- Derived stats ----------

// Everything here is computed from the orders already fetched, so the
// dashboard never needs a second round trip for its summary numbers.
export function computeStats(orders) {
  const delivered = orders.filter((o) => o.status === 'delivered')
  const cancelled = orders.filter((o) => o.status === 'cancelled')
  const pending = orders.filter((o) => o.status === 'pending' || o.status === 'shipped')

  // Revenue counts delivered orders only — COD money isn't real until it lands.
  const revenue = delivered.reduce((sum, o) => sum + Number(o.subtotal), 0)
  const pendingValue = pending.reduce((sum, o) => sum + Number(o.subtotal), 0)

  return {
    totalOrders: orders.length,
    delivered: delivered.length,
    cancelled: cancelled.length,
    pending: pending.length,
    revenue,
    pendingValue,
  }
}

// Groups orders into daily buckets for the last `days` days, for the chart.
export function dailySeries(orders, days = 14) {
  const buckets = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.push({ date: d, orders: 0, value: 0 })
  }

  orders.forEach((o) => {
    const placed = new Date(o.created_at)
    placed.setHours(0, 0, 0, 0)
    const bucket = buckets.find((b) => b.date.getTime() === placed.getTime())
    if (bucket) {
      bucket.orders += 1
      bucket.value += Number(o.subtotal)
    }
  })

  return buckets
}

// Counts units sold per product across all non-cancelled orders.
export function topProducts(orders, limit = 5) {
  const tally = new Map()

  orders
    .filter((o) => o.status !== 'cancelled')
    .forEach((o) => {
      ;(o.order_items || []).forEach((item) => {
        const prev = tally.get(item.product_name) || { name: item.product_name, units: 0, value: 0 }
        prev.units += item.qty
        prev.value += item.qty * Number(item.price)
        tally.set(item.product_name, prev)
      })
    })

  return [...tally.values()].sort((a, b) => b.units - a.units).slice(0, limit)
}

// ---------- Product write operations ----------

// The UI keeps products in the camelCase shape the storefront uses; the table
// is snake_case. Converting here keeps the form components unaware of the
// column names.
function toRow(p) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    variant: p.variant,
    price: Number(p.price),
    drop_name: p.drop,
    is_new: Boolean(p.isNew),
    featured: Boolean(p.featured),
    images: p.images ?? [],
    description: p.description ?? '',
    sizes: p.sizes ?? [],
    sizes_out: p.sizesOut ?? [],
    specs: p.specs ?? [],
  }
}

export async function saveProduct(product, isNewRecord) {
  const row = toRow(product)

  const query = isNewRecord
    ? supabase.from('products').insert(row)
    : supabase.from('products').update(row).eq('id', row.id)

  const { error } = await query

  if (error) {
    console.error('[Supabase] saveProduct failed:', error.message)
    return { error }
  }

  return { error: null }
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id)

  if (error) {
    console.error('[Supabase] deleteProduct failed:', error.message)
    return { error }
  }

  return { error: null }
}
