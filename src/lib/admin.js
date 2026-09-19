import { supabase } from './supabaseClient.js'
import { lowSizes, LOW_STOCK_AT } from './stock.js'

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

// ---------- Refunds & returns ----------

export async function fetchReturns() {
  const { data, error } = await supabase
    .from('order_returns')
    .select('*, orders(customer_name, customer_phone)')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[Supabase] fetchReturns failed:', error.message)
    return { returns: [], error }
  }
  return { returns: data, error: null }
}

export async function createReturn({ orderId, reason }) {
  const { error } = await supabase.from('order_returns').insert({
    order_id: orderId,
    reason,
  })

  if (error) {
    console.error('[Supabase] createReturn failed:', error.message)
    return { error }
  }
  return { error: null }
}

export async function resolveReturn(id, note) {
  const { error } = await supabase
    .from('order_returns')
    .update({ status: 'resolved', note: note || null, resolved_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[Supabase] resolveReturn failed:', error.message)
    return { error }
  }
  return { error: null }
}

// ---------- Abandoned carts ----------

// Unconverted only — the moment a session's order goes through,
// markCartConverted (src/lib/abandonedCart.js) takes it off this list.
export async function fetchAbandonedCarts() {
  const { data, error } = await supabase
    .from('abandoned_carts')
    .select('*')
    .is('converted_order_id', null)
    .order('last_active', { ascending: false })

  if (error) {
    console.error('[Supabase] fetchAbandonedCarts failed:', error.message)
    return { carts: [], error }
  }
  return { carts: data, error: null }
}

// A sale agreed over DM never touches the checkout page, so nothing takes the
// pieces off the shelf or counts the revenue unless it goes through here too.
// Routed through the same place_order the website uses — the stock lock,
// the sold-out check and the order/order_items write are exactly the ones a
// checkout order gets, so a DM sale can't oversell a size the website has
// already sold out, and it shows up in every count exactly like any other.
export async function createManualOrder({ order, items }) {
  const { error } = await supabase.rpc('place_order', { payload: { order, items } })

  if (error) {
    console.error('[Supabase] createManualOrder failed:', error.message)
    return { error }
  }
  return { error: null }
}

// Reads a screenshot or pasted text of a DM order and asks Gemini to guess
// the customer's details and what they're buying, matched against the real
// catalog. Never writes anything itself — the form still goes through
// createManualOrder above once a person has checked the guess over.
export async function extractOrderFromMessage({ text, image, mimeType }) {
  const { data, error } = await supabase.functions.invoke('parse-order-message', {
    body: { text, image, mimeType },
  })

  if (error) {
    // The client only gives a generic "non-2xx status" message here — the
    // function's own {error: "..."} body, which says what actually went
    // wrong, is on the raw response it stashes on context.
    let detail = error.message
    try {
      const body = await error.context?.json()
      if (body?.error) detail = body.error
    } catch {
      // Not JSON, or no context — the generic message is all there is.
    }

    console.error('[Supabase] extractOrderFromMessage failed:', detail)
    return { extracted: null, error: { message: detail } }
  }
  if (data?.error) return { extracted: null, error: { message: data.error } }

  return { extracted: data.extracted, error: null }
}

// place_order raises a tagged message for the cases worth explaining
// specifically — the same convention Checkout.jsx parses on the customer
// side, reused here for the admin's own order form.
export function orderErrorMessage(error) {
  const raw = error?.message || ''

  const soldOut = raw.match(/SOLD_OUT:(.*):(.*)/)
  if (soldOut) return `${soldOut[1]} in size ${soldOut[2]} is sold out.`

  const gone = raw.match(/UNAVAILABLE:(.*)/)
  if (gone) return `${gone[1]} is no longer available.`

  if (error?.code === '23505' || raw.includes('orders_advance_trx_id_idx')) {
    return 'That transaction ID has already been used on another order.'
  }

  if (raw.includes('EMPTY_CART')) return 'Add at least one item.'

  return 'Could not place the order — check the details and try again.'
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
  const pending = orders.filter((o) => o.status === 'pending')
  const shipped = orders.filter((o) => o.status === 'shipped')

  // Anything still owed to us: placed but not yet delivered or cancelled.
  const open = [...pending, ...shipped]

  // Revenue counts delivered orders only — COD money isn't real until it lands.
  const revenue = delivered.reduce((sum, o) => sum + Number(o.subtotal), 0)
  const openValue = open.reduce((sum, o) => sum + Number(o.subtotal), 0)

  // Pieces, not orders — one order can carry several units of several products.
  // Cancelled orders never counted as a sale, so they're left out.
  const unitsSold = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce(
      (sum, o) => sum + (o.order_items || []).reduce((s, it) => s + Number(it.qty), 0),
      0
    )

  return {
    totalOrders: orders.length,
    unitsSold,
    delivered: delivered.length,
    cancelled: cancelled.length,
    pending: pending.length,
    shipped: shipped.length,
    open: open.length,
    revenue,
    openValue,
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
        // Grouped by id rather than name — two products sharing a name (a
        // colour variant, say) would otherwise merge into one bestseller.
        const key = item.product_id || item.product_name
        const prev = tally.get(key) || { id: item.product_id, name: item.product_name, units: 0, value: 0 }
        prev.units += item.qty
        prev.value += item.qty * Number(item.price)
        tally.set(key, prev)
      })
    })

  return [...tally.values()].sort((a, b) => b.units - a.units).slice(0, limit)
}

// Counts units sold per month for the last `months` months, for the bar chart.
// Cancelled orders are excluded so the bars only ever show real sales.
export function monthlySeries(orders, months = 6) {
  const now = new Date()
  const buckets = []

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      year: d.getFullYear(),
      orders: 0,
      units: 0,
      value: 0,
    })
  }

  const byKey = new Map(buckets.map((b) => [b.key, b]))

  orders
    .filter((o) => o.status !== 'cancelled')
    .forEach((o) => {
      const d = new Date(o.created_at)
      const bucket = byKey.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (!bucket) return

      bucket.orders += 1
      bucket.value += Number(o.subtotal)
      ;(o.order_items || []).forEach((it) => {
        bucket.units += Number(it.qty)
      })
    })

  return buckets
}

// Order lines only record the product's name and price, not which drop or
// category it belonged to — those live on the product row, so the sold units
// are matched back to the catalog by id. A product deleted since the sale has
// nothing to match, so its units land in the fallback bucket rather than
// disappearing from the totals.
function groupSales(orders, products, column, fallback) {
  const catalog = new Map(products.map((p) => [String(p.id), p]))
  const tally = new Map()

  orders
    .filter((o) => o.status !== 'cancelled')
    .forEach((o) => {
      ;(o.order_items || []).forEach((it) => {
        const product = catalog.get(String(it.product_id))
        const label = (product && product[column]) || fallback
        const prev = tally.get(label) || { name: label, units: 0, value: 0, orders: 0 }

        prev.units += Number(it.qty)
        prev.value += Number(it.qty) * Number(it.price)
        prev.orders += 1
        tally.set(label, prev)
      })
    })

  return [...tally.values()].sort((a, b) => b.units - a.units)
}

// Units sold per drop — "how much did DROP 01 move".
export function salesByDrop(orders, products) {
  return groupSales(orders, products, 'drop_name', 'No drop')
}

// Units sold per category — "how many hoodies, how many jackets".
export function salesByCategory(orders, products) {
  return groupSales(orders, products, 'category', 'Uncategorised')
}

// Orders grouped by where the customer clicked in from — the utm_source
// captured off the link they landed on, so "reel A got 12 orders, story got
// 3" is read straight off the data instead of guessed. Orders with no
// tracked link (typed the URL, opened a bookmark) land in the fallback.
export function salesByAttribution(orders, fallback = 'Direct / no link') {
  const tally = new Map()

  orders
    .filter((o) => o.status !== 'cancelled')
    .forEach((o) => {
      const label = o.utm_source || fallback
      const prev = tally.get(label) || { name: label, orders: 0, value: 0 }

      prev.orders += 1
      prev.value += Number(o.total ?? o.subtotal)
      tally.set(label, prev)
    })

  return [...tally.values()].sort((a, b) => b.orders - a.orders)
}

// Every size that has run out or is about to, across the catalog — the
// reorder list, shortest first.
export function lowStockSizes(products, threshold = LOW_STOCK_AT) {
  const rows = []

  products.forEach((p) => {
    lowSizes(p, threshold).forEach(({ size, left }) => {
      rows.push({ id: p.id, name: p.name, variant: p.variant, size, left })
    })
  })

  return rows.sort((a, b) => a.left - b.left || a.name.localeCompare(b.name))
}

// ---------- Customer history ----------

// COD only works on trust, and the phone number is the only thing that ties a
// stranger's orders together. Someone who has refused two parcels already is
// worth a confirmation call before the third goes out — that judgement needs
// the history in front of you at the moment you're looking at the order.

// Numbers get typed with and without the country code, so they are compared by
// their last 11 digits — the part that actually identifies a BD mobile.
export function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-11)
}

function riskLevel(entry) {
  // A first order has no history to judge; saying nothing is the honest answer.
  if (entry.total <= 1) return 'new'

  // Refusing twice, or refusing more often than accepting, is the pattern that
  // costs money in return fare.
  if (entry.cancelled >= 2 || (entry.cancelled >= 1 && entry.cancelled > entry.delivered)) {
    return 'risk'
  }

  if (entry.cancelled === 1) return 'watch'
  if (entry.delivered >= 1) return 'good'

  return 'neutral'
}

// One pass over the orders already in memory: phone number → what that number
// has done so far. No extra round trip, and every row can look itself up.
export function customerIndex(orders) {
  const index = new Map()

  orders.forEach((o) => {
    const key = phoneKey(o.customer_phone)
    if (!key) return

    const entry = index.get(key) || {
      total: 0,
      delivered: 0,
      cancelled: 0,
      open: 0,
      collected: 0,
    }

    entry.total += 1

    if (o.status === 'delivered') {
      entry.delivered += 1
      entry.collected += Number(o.total ?? o.subtotal)
    } else if (o.status === 'cancelled') {
      entry.cancelled += 1
    } else {
      entry.open += 1
    }

    index.set(key, entry)
  })

  index.forEach((entry) => {
    entry.level = riskLevel(entry)
  })

  return index
}

export function lookupCustomer(index, phone) {
  return (
    index.get(phoneKey(phone)) || {
      total: 0,
      delivered: 0,
      cancelled: 0,
      open: 0,
      collected: 0,
      level: 'new',
    }
  )
}

// One row per phone number, for the Customers tab's own list — customerIndex
// above is keyed the same way but built for a single lookup, not a table, so
// it never bothered keeping a name.
export function customerList(orders) {
  const byPhone = new Map()

  orders.forEach((o) => {
    const key = phoneKey(o.customer_phone)
    if (!key) return

    const entry = byPhone.get(key) || { name: o.customer_name, phone: o.customer_phone, orders: 0, totalSpent: 0 }
    entry.orders += 1
    if (o.status === 'delivered') entry.totalSpent += Number(o.total ?? o.subtotal)
    byPhone.set(key, entry)
  })

  return [...byPhone.values()].sort((a, b) => b.orders - a.orders)
}

// New (one order) vs repeat (more than one) — the split the Customers tab
// shows as a headline, built off the same per-phone counts as customerList.
export function repeatVsNew(orders) {
  const list = customerList(orders)
  return {
    new: list.filter((c) => c.orders === 1).length,
    repeat: list.filter((c) => c.orders > 1).length,
  }
}

// ---------- Cost & margin ----------

// Only products with a cost actually entered — a null cost would otherwise
// read as "free to make" and show a false 100% margin.
export function costAndMargin(products) {
  return products
    .filter((p) => p.cost != null && p.cost !== '')
    .map((p) => {
      const cost = Number(p.cost)
      const price = Number(p.price)
      const margin = price > 0 ? ((price - cost) / price) * 100 : 0
      return { id: p.id, name: p.name, variant: p.variant, cost, price, margin }
    })
    .sort((a, b) => b.margin - a.margin)
}

// ---------- Reviews ----------

export async function fetchAllReviews() {
  const { data, error } = await supabase
    .from('product_reviews')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[Supabase] fetchAllReviews failed:', error.message)
    return { reviews: [], error }
  }
  return { reviews: data, error: null }
}

// ---------- Marketing (manual entry) ----------

// Four tables, one identical shape each — fetch/add/remove, admin-only, no
// live API behind any of them yet. A factory rather than four copies of the
// same three functions.
function metricApi(table) {
  return {
    fetch: async () => {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error(`[Supabase] fetch ${table} failed:`, error.message)
        return { rows: [], error }
      }
      return { rows: data, error: null }
    },
    add: async (row) => {
      const { error } = await supabase.from(table).insert(row)
      if (error) console.error(`[Supabase] insert into ${table} failed:`, error.message)
      return { error }
    },
    remove: async (id) => {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) console.error(`[Supabase] delete from ${table} failed:`, error.message)
      return { error }
    },
  }
}

export const adSpendApi = metricApi('ad_spend')
export const emailCampaignsApi = metricApi('email_campaigns')
export const socialStatsApi = metricApi('social_stats')
export const couponStatsApi = metricApi('coupon_stats')

// ---------- Analytics ----------

// Last `days` days only — this table grows with every page the storefront
// ever renders, and nothing in Analytics looks further back than a window
// anyway.
export async function fetchPageViews(days = 30) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('page_views')
    .select('session_id, path, created_at')
    .gte('created_at', since.toISOString())

  if (error) {
    console.error('[Supabase] fetchPageViews failed:', error.message)
    return { views: [], error }
  }
  return { views: data, error: null }
}

// A raw path is too specific to read at a glance (every product is its own
// URL) — grouped into the same handful of page types the store actually has.
function pageType(path) {
  if (path === '/') return 'Homepage'
  if (path === '/shop') return 'Shop'
  if (path.startsWith('/product/')) return 'Product page'
  if (path === '/cart') return 'Cart'
  if (path === '/checkout') return 'Checkout'
  if (path === '/order-confirmed') return 'Order confirmed'
  if (path === '/about') return 'About'
  if (path === '/track') return 'Track order'
  return path
}

// One row per page type: how many times it was viewed, and — of the
// sessions that landed there first — what fraction never viewed a second
// page. A page can only "bounce" as an entry point, so bounces are counted
// against each session's first pageview, not every page it happened to visit.
export function trafficByPage(views) {
  const bySession = new Map()
  views.forEach((v) => {
    const arr = bySession.get(v.session_id) || []
    arr.push(v)
    bySession.set(v.session_id, arr)
  })

  const stats = new Map()
  const bump = (type) => {
    const s = stats.get(type) || { page: type, visits: 0, entries: 0, bounces: 0 }
    stats.set(type, s)
    return s
  }

  bySession.forEach((sessionViews) => {
    sessionViews.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    sessionViews.forEach((v) => { bump(pageType(v.path)).visits += 1 })

    const entry = bump(pageType(sessionViews[0].path))
    entry.entries += 1
    if (sessionViews.length === 1) entry.bounces += 1
  })

  return [...stats.values()]
    .map((s) => ({ ...s, bounceRate: s.entries > 0 ? (s.bounces / s.entries) * 100 : 0 }))
    .sort((a, b) => b.visits - a.visits)
}

// Unique visiting sessions vs orders placed in the same window — the two
// halves of a conversion rate, read off data that's already real on both
// sides once page views exist at all.
export function conversionRate(views, orders, days = 14) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const visitors = new Set(
    views.filter((v) => new Date(v.created_at) >= since).map((v) => v.session_id)
  ).size

  const orderCount = orders.filter(
    (o) => new Date(o.created_at) >= since && o.status !== 'cancelled'
  ).length

  return {
    visitors,
    orders: orderCount,
    rate: visitors > 0 ? (orderCount / visitors) * 100 : 0,
  }
}

// Highest-selling districts — straight off customer_area, which every order
// already has, so this needed no new tracking at all.
export function salesByDistrict(orders) {
  const tally = new Map()

  orders
    .filter((o) => o.status !== 'cancelled')
    .forEach((o) => {
      const key = o.customer_area || 'Unknown'
      const prev = tally.get(key) || { name: key, orders: 0, value: 0 }
      prev.orders += 1
      prev.value += Number(o.total ?? o.subtotal)
      tally.set(key, prev)
    })

  return [...tally.values()].sort((a, b) => b.orders - a.orders)
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
    cost: p.cost === '' || p.cost == null ? null : Number(p.cost),
    drop_name: p.drop,
    category: p.category || null,
    is_new: Boolean(p.isNew),
    featured: Boolean(p.featured),
    images: p.images ?? [],
    description: p.description ?? '',
    sizes: p.sizes ?? [],
    sizes_out: p.sizesOut ?? [],
    stock: p.stock ?? null,
    details: p.details ?? '',
    size_chart: p.sizeChart ?? null,
    colour_group: p.colourGroup?.trim() || null,
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
