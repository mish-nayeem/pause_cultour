import { supabase } from './supabaseClient.js'
import { dropKey } from './lookbook.js'
import { COD_FEE_RATE, returnFeePaid } from './admin.js'

// Drops and their money: what each drop sold (from the orders, by itself)
// and what it cost (typed in — drop_costs, see
// supabase-migration-drop-costs.sql).

// Each drop (products.drop_name), with its products and when it started:
// the earliest launch time, or when its first product was added.
export function listDrops(products) {
  const map = new Map()
  for (const p of products) {
    const name = String(p.drop_name || '').trim()
    if (!name) continue
    const k = dropKey(name)
    const d = map.get(k) || { key: k, name, ids: new Set(), products: [], start: Infinity }
    d.ids.add(String(p.id))
    d.products.push(p)
    const t = new Date(p.publish_at || p.created_at).getTime()
    if (t < d.start) d.start = t
    map.set(k, d)
  }
  return [...map.values()].sort((a, b) => b.start - a.start)
}

// One drop's share of every order between `from` and `to` (ms): its own
// pieces, and its part — by value — of what's charged to the whole order
// (the coupon, a returned parcel's unpaid delivery, a second parcel we
// paid for). The courier's 1% is on the drop's pieces as collected.
export function dropFigures(orders, drop, from, to) {
  const f = {
    orders: 0,
    pieces: 0,
    listValue: 0, // the pieces at the price they sold at, before any coupon
    discounts: 0, // coupons, the drop's share
    sales: 0, // listValue − discounts, every order placed (not cancelled/returned)
    delivered: 0, // the same, delivered orders only — what was collected
    codFee: 0, // the courier's 1% on that
    shopPaidParcels: 0, // returned parcels' unpaid delivery + 2nd parcels we paid, the drop's share
    revenue: 0, // delivered − codFee − shopPaidParcels
    toCollect: 0, // on the way: still to come in, after the 1%
    returnedPieces: 0,
    unitCost: 0, // pieces sold × the products' own cost (Cost & margin), where set
    byProduct: new Map(),
  }
  const costOf = new Map(drop.products.map((p) => [String(p.id), p.cost == null || p.cost === '' ? null : Number(p.cost)]))

  for (const o of orders) {
    const t = new Date(o.created_at).getTime()
    if (t < from || t >= to) continue
    const all = o.order_items || []
    const mine = all.filter((it) => drop.ids.has(String(it.product_id)))
    if (!mine.length) continue

    const value = (list) => list.reduce((n, it) => n + Number(it.price) * Number(it.qty), 0)
    const mineValue = value(mine)
    const allValue = value(all) || 1
    const share = mineValue / allValue
    const discount = (Number(o.discount_amount) || 0) * share
    const pieces = mine.reduce((n, it) => n + Number(it.qty), 0)

    if (o.status === 'returned') {
      f.returnedPieces += pieces
      if (!returnFeePaid(o)) f.shopPaidParcels += (Number(o.delivery_fee) || 0) * share
      continue
    }
    if (o.status === 'cancelled') continue

    f.orders++
    f.pieces += pieces
    f.listValue += mineValue
    f.discounts += discount
    const net = mineValue - discount
    f.sales += net
    for (const it of mine) {
      const e = f.byProduct.get(it.product_name) || { pieces: 0, value: 0 }
      e.pieces += Number(it.qty)
      e.value += Number(it.price) * Number(it.qty)
      f.byProduct.set(it.product_name, e)
      const c = costOf.get(String(it.product_id))
      if (c != null) f.unitCost += c * Number(it.qty)
    }

    if (o.status === 'delivered') {
      // The 1% was taken on what the rider collected — refunds came later.
      const collected = net + (Number(o.refunded) || 0) * share
      const cod = collected * COD_FEE_RATE
      f.delivered += net
      f.codFee += cod
      f.shopPaidParcels += (Number(o.exchange_fee_unpaid) || 0) * share
    } else {
      f.toCollect += net * (1 - COD_FEE_RATE)
    }
  }
  f.revenue = f.delivered - f.codFee - f.shopPaidParcels
  return f
}

// ---------- Costs typed in ----------

const MIGRATION = 'Run supabase-migration-drop-costs.sql in Supabase first.'

export async function fetchDropCosts() {
  const { data, error } = await supabase.from('drop_costs').select('*').order('spent_on', { ascending: true })
  if (error) {
    console.error('[Supabase] fetchDropCosts failed:', error.message)
    return { costs: [], error: /drop_costs/.test(error.message || '') ? MIGRATION : "Couldn't load the costs." }
  }
  return { costs: data, error: null }
}

export async function addDropCost(row) {
  const { data, error } = await supabase.from('drop_costs').insert(row).select().single()
  if (error) {
    console.error('[Supabase] addDropCost failed:', error.message)
    return { cost: null, error: /drop_costs/.test(error.message || '') ? MIGRATION : "Couldn't save that cost." }
  }
  return { cost: data, error: null }
}

export async function deleteDropCost(id) {
  const { error } = await supabase.from('drop_costs').delete().eq('id', id)
  if (error) console.error('[Supabase] deleteDropCost failed:', error.message)
  return { error: error ? "Couldn't delete that cost." : null }
}
