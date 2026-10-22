import { supabase } from './supabaseClient.js'
import { fromLocalInput } from './schedule.js'
import { lowSizes, LOW_STOCK_AT } from './stock.js'

// ---------- Admin allowlist ----------

// Only this email can open the admin panel. Set it in .env locally and in the
// Vercel project's Environment Variables for the deployed site.
// This check is convenience, not security — the real enforcement lives in the
// Supabase RLS policies, which reject queries from any other logged-in account
// even if someone bypasses this file. Both must name the same address.
// What the items actually sold for: the subtotal less any coupon. Revenue
// figures use this, so a discount isn't counted as money taken.
function itemsNet(o) {
  return Number(o.subtotal) - (Number(o.discount_amount) || 0)
}

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

// Signing in lives in auth.js — one login for admins and customers.

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  const session = data.session

  // A signed-in customer isn't an admin — but they're still a customer, so
  // this reports "no admin session" without ending their login.
  if (session && !isAdminEmail(session.user?.email)) return null

  return session
}

// ---------- Orders ----------

// Pieces refunded from Support → Returns & exchanges no longer count as sold,
// and the taka given back no longer counts as revenue. Every figure in the
// panel reads an item's `qty` and an order's `subtotal` / `total`, so they're
// netted here once; what was originally ordered and paid is kept alongside
// (ordered_qty, paid_subtotal, paid_total) for the order's own details.
function netOfRefunds(o) {
  const refunded = Number(o.refunded_amount) || 0
  // Pieces handed back to the rider at the door (✕ on the item): never
  // paid for, so they come off what's collected as well as what's sold.
  let rejectedValue = 0
  let changed = refunded > 0
  const items = (o.order_items || []).map((it) => {
    const refundedBack = Number(it.returned_qty) || 0
    const doorBack = Number(it.rejected_qty) || 0
    if (!refundedBack && !doorBack) return it
    changed = true
    rejectedValue += Number(it.price) * doorBack
    return { ...it, ordered_qty: it.qty, qty: Math.max(0, Number(it.qty) - refundedBack - doorBack) }
  })
  if (!changed) return o
  const off = refunded + rejectedValue
  return {
    ...o,
    order_items: items,
    refunded,
    rejected_value: rejectedValue,
    paid_subtotal: o.subtotal,
    paid_total: o.total,
    subtotal: Number(o.subtotal) - off,
    total: o.total == null ? o.total : Number(o.total) - off,
  }
}

// ✕ on one line of an order: the customer handed those pieces back to the
// rider. They go back into stock and stop counting as sold; `undo` reverses
// it. See supabase-migration-returned-status.sql.
export async function rejectOrderItem(itemId, undo = false) {
  const { error } = await supabase.rpc('admin_reject_item', { p_item_id: itemId, p_undo: undo })
  if (error) {
    console.error('[Supabase] rejectOrderItem failed:', error.message)
    const m = error.message || ''
    if (m.includes('admin_reject_item')) return { error: 'Run supabase-migration-returned-status.sql in Supabase first.' }
    return { error: m.startsWith('Not enough stock') || m.startsWith('This order') ? m : "Couldn't update that item. Try again." }
  }
  return { error: null }
}

export async function fetchOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[Supabase] fetchOrders failed:', error.message)
    return { orders: [], error }
  }
  return { orders: data.map(netOfRefunds), error: null }
}

// Routed through update_order_status rather than a plain table update — it's
// the function that gives a size's stock back when an order is cancelled (a
// COD refusal never returned it on its own before) and best-effort reverses
// that if the cancel gets corrected back to another status.
export async function updateOrderStatus(orderId, status) {
  const { error } = await supabase.rpc('update_order_status', {
    p_order_id: orderId,
    p_new_status: status,
  })

  if (error) {
    console.error('[Supabase] updateOrderStatus failed:', error.message)
    return { error }
  }
  return { error: null }
}

// ---------- Blocked attempts (rate limiter) ----------

// Fake or scripted place_order calls the rate limiter turned away — who they
// claimed to be (phone/email/name) and which IP made the attempt. See
// supabase-migration-rate-limiting.sql and -blocked-attempts.sql.
export async function fetchBlockedAttempts() {
  const { data, error } = await supabase
    .from('blocked_attempts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[Supabase] fetchBlockedAttempts failed:', error.message)
    return { attempts: [], error }
  }
  return { attempts: data, error: null }
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

// A request logged by hand, for one raised over a DM or a call — completed
// from Support → Returns & exchanges the same way as one from the portal.
export async function createReturn({ orderId, reason, kind = 'exchange' }) {
  const { error } = await supabase.from('order_returns').insert({
    order_id: orderId,
    reason,
    kind,
    source: 'admin',
    seen_at: new Date().toISOString(),
  })

  if (error) {
    console.error('[Supabase] createReturn failed:', error.message)
    return { error }
  }
  return { error: null }
}

// Completes a request: an exchange swaps the sizes in stock, a refund puts
// the pieces back and takes the money off the order's revenue, a reject
// just closes it. See supabase-migration-returns-processing.sql.
export async function processReturn({ id, action, items = [], refund = 0, note = '', fee = 0, feePaid = true }) {
  const { data, error } = await supabase.rpc('admin_process_return', {
    p_return_id: id,
    p_action: action,
    p_items: items,
    p_refund: refund,
    p_note: note,
    p_fee: fee,
    p_fee_paid: feePaid,
  })
  if (error) {
    console.error('[Supabase] processReturn failed:', error.message)
    return { result: null, error }
  }
  return { result: data, error: null }
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
  const { data, error } = await supabase.rpc('place_order', { payload: { order, items } })

  if (error) {
    console.error('[Supabase] createManualOrder failed:', error.message)
    return { id: null, error }
  }
  return { id: data, error: null }
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

  const priceChanged = raw.match(/PRICE_CHANGED:(.*)/)
  if (priceChanged) return `${priceChanged[1]}'s price changed — remove it and add it again.`

  if (raw.includes('PRICE_MISMATCH') || raw.includes('INVALID_QTY')) {
    return 'The totals are out of date — reload the page and try again.'
  }

  if (raw.includes('RATE_LIMITED')) {
    return 'Too many orders placed in a short time — wait a few minutes and try again.'
  }

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

// Orders that never became a sale: cancelled, or returned by the courier
// (the customer couldn't be reached or refused at the door). Neither counts
// toward units, sales or revenue, and both put the stock back.
export const UNSOLD = ['cancelled', 'returned']

export function unsold(o) {
  return UNSOLD.includes(o?.status)
}

// ---------- What reaches the shop ----------
// The courier (Steadfast, RedX…) keeps the whole delivery charge, and takes
// COD_FEE_RATE of the product amount it collects — on a 1000 taka piece with
// 80 delivery, the rider collects 1080, the courier keeps 80 + 10, and 990
// is ours. Change the rate here if the courier's does.
export const COD_FEE_RATE = 0.01

// A returned parcel still costs its delivery charge. Paid (the bKash advance
// covered it, or the customer paid it after): costs us nothing. Unpaid: it
// comes off our revenue. Set by the admin on the order; until then, paid
// when the advance was enough to cover the charge.
export function returnFeePaid(o) {
  if (o.return_fee_paid != null) return Boolean(o.return_fee_paid)
  return (Number(o.advance_amount) || 0) >= (Number(o.delivery_fee) || 0)
}

// One order's money, split three ways: what the customer paid for the
// products, what the courier keeps, and what's left for us. Only delivered
// and returned orders have any — the rest haven't settled yet.
export function orderMoney(o) {
  const fee = Number(o.delivery_fee) || 0
  if (o.status === 'delivered') {
    const items = itemsNet(o)
    const codFee = Math.round(items * COD_FEE_RATE * 100) / 100
    // An exchange's second parcel: its delivery charge is the courier's
    // too. Paid by the customer it passes straight through; paid by us
    // (exchange_fee_unpaid) it comes off what we keep.
    const exchange = Number(o.exchange_fees) || 0
    const exchangeUnpaid = Number(o.exchange_fee_unpaid) || 0
    return {
      items,
      delivery: fee,
      codFee,
      exchange,
      exchangeUnpaid,
      courier: fee + codFee + exchange,
      toShop: items - codFee - exchangeUnpaid,
      receivable: items - codFee - exchangeUnpaid,
    }
  }
  // Not delivered yet: what will reach us once it is — the receivable.
  // Nothing counts toward revenue until then.
  if (o.status === 'pending' || o.status === 'shipped') {
    const items = itemsNet(o)
    const codFee = Math.round(items * COD_FEE_RATE * 100) / 100
    return { items, delivery: fee, codFee, courier: 0, toShop: 0, receivable: items - codFee, expected: true }
  }
  if (o.status === 'returned') {
    const paid = returnFeePaid(o)
    return { items: 0, delivery: fee, codFee: 0, courier: fee, toShop: paid ? 0 : -fee, returnFeePaid: paid }
  }
  return { items: 0, delivery: 0, codFee: 0, courier: 0, toShop: 0 }
}

// The returned order's delivery charge: paid by the customer or not.
// See supabase-migration-courier-money.sql.
export async function setReturnFeePaid(orderId, paid) {
  const { error } = await supabase.rpc('admin_set_return_fee', { p_order_id: orderId, p_paid: paid })
  if (error) {
    console.error('[Supabase] setReturnFeePaid failed:', error.message)
    if ((error.message || '').includes('admin_set_return_fee')) return { error: 'Run supabase-migration-courier-money.sql in Supabase first.' }
    return { error: "Couldn't save that. Try again." }
  }
  return { error: null }
}

// Everything here is computed from the orders already fetched, so the
// dashboard never needs a second round trip for its summary numbers.
export function computeStats(orders) {
  const delivered = orders.filter((o) => o.status === 'delivered')
  const cancelled = orders.filter((o) => o.status === 'cancelled')
  const pending = orders.filter((o) => o.status === 'pending')
  const shipped = orders.filter((o) => o.status === 'shipped')
  const returned = orders.filter((o) => o.status === 'returned')

  // Anything still owed to us: placed but not yet delivered or cancelled.
  const open = [...pending, ...shipped]

  // Revenue is what reaches us: delivered orders' products less the
  // courier's COD fee (the delivery charge was never ours — the courier keeps
  // it), less the delivery charge of any returned parcel nobody paid for.
  // COD money isn't real until it lands, so nothing open counts.
  let revenue = 0
  let courierTook = 0
  let returnLoss = 0
  for (const o of [...delivered, ...returned]) {
    const m = orderMoney(o)
    revenue += m.toShop
    courierTook += m.courier
    if (m.toShop < 0) returnLoss -= m.toShop
  }
  // Still to collect: what those orders will bring in after the courier.
  const openValue = open.reduce((sum, o) => sum + orderMoney(o).receivable, 0)

  // Pieces, not orders — one order can carry several units of several products.
  // Cancelled orders never counted as a sale, so they're left out.
  const unitsSold = orders
    .filter((o) => !unsold(o))
    .reduce(
      (sum, o) => sum + (o.order_items || []).reduce((s, it) => s + Number(it.qty), 0),
      0
    )

  return {
    totalOrders: orders.length,
    unitsSold,
    delivered: delivered.length,
    cancelled: cancelled.length,
    returned: returned.length,
    pending: pending.length,
    shipped: shipped.length,
    open: open.length,
    revenue,
    courierTook,
    returnLoss,
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
      bucket.value += itemsNet(o)
    }
  })

  return buckets
}

// Counts units sold per product across all non-cancelled orders.
export function topProducts(orders, limit = 5) {
  const tally = new Map()

  orders
    .filter((o) => !unsold(o))
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
    .filter((o) => !unsold(o))
    .forEach((o) => {
      const d = new Date(o.created_at)
      const bucket = byKey.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (!bucket) return

      bucket.orders += 1
      bucket.value += itemsNet(o)
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
    .filter((o) => !unsold(o))
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
    .filter((o) => !unsold(o))
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
    } else if (unsold(o)) {
      // Returned (couldn't be reached, refused at the door) costs the same
      // return fare as a cancel, so it weighs the same.
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

    const entry = byPhone.get(key) || {
      name: o.customer_name,
      phone: o.customer_phone,
      orders: 0,
      delivered: 0,
      cancelled: 0,
      totalSpent: 0,
      firstAt: o.created_at,
      lastAt: o.created_at,
    }
    entry.orders += 1
    if (o.status === 'delivered') {
      entry.delivered += 1
      entry.totalSpent += Number(o.total ?? o.subtotal)
    }
    if (unsold(o)) entry.cancelled += 1
    if (o.created_at < entry.firstAt) entry.firstAt = o.created_at
    if (o.created_at > entry.lastAt) {
      entry.lastAt = o.created_at
      // The name they used most recently.
      entry.name = o.customer_name
    }
    byPhone.set(key, entry)
  })

  return [...byPhone.values()].sort((a, b) => b.orders - a.orders)
}

// New (one order) vs repeat (more than one) — the split the Customers tab
// shows as a headline, built off the same per-phone counts as customerList.
// Also: what each side has spent (delivered orders only), the share of
// customers who came back, and the repeat customers themselves, most orders
// first — the regulars.
export function repeatVsNew(orders) {
  const list = customerList(orders)
  const once = list.filter((c) => c.orders === 1)
  const back = list.filter((c) => c.orders > 1)
  const spent = (rows) => rows.reduce((sum, c) => sum + c.totalSpent, 0)
  return {
    new: once.length,
    repeat: back.length,
    rate: list.length ? Math.round((back.length / list.length) * 100) : 0,
    newSpent: spent(once),
    repeatSpent: spent(back),
    regulars: back.sort((a, b) => b.orders - a.orders || b.totalSpent - a.totalSpent),
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

// Analytics is added up in the database now — admin_analytics(), read by
// src/components/AnalyticsManager.jsx.

// ---------- Product write operations ----------

// The UI keeps products in the camelCase shape the storefront uses; the table
// is snake_case. Converting here keeps the form components unaware of the
// column names.
function toRow(p) {
  return {
    id: p.id,
    sku: p.sku,
    name: (p.name || '').trim(),
    variant: p.variant,
    price: Number(p.price),
    cost: p.cost === '' || p.cost == null ? null : Number(p.cost),
    drop_name: p.drop?.trim() || null,
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
    publish_at: fromLocalInput(p.publishAt),
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
