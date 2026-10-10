import { supabase } from './supabaseClient.js'

// Coupons: the checkout's "Apply" and the admin's list. The discount the
// checkout shows comes from check_coupon, and place_order works it out again
// on its own when the order is placed — see supabase-migration-coupons.sql.

// place_order / check_coupon raise tagged messages; these say them plainly.
export function couponMessage(error) {
  const raw = error?.message || ''
  let m
  if (raw.includes('COUPON_INVALID')) return "That code isn't valid."
  if (raw.includes('COUPON_NOT_STARTED')) return "That code isn't active yet."
  if (raw.includes('COUPON_EXPIRED')) return 'That code has expired.'
  if ((m = raw.match(/COUPON_MIN:([\d.]+)/))) return `This code needs an order of ৳ ${Number(m[1]).toLocaleString()} or more.`
  if (raw.includes('COUPON_USED_UP')) return 'That code has been fully used.'
  if (raw.includes('COUPON_ALREADY_USED')) return "You've already used this code."
  if (raw.includes('RATE_LIMITED')) return 'Too many tries — wait a little and try again.'
  return null
}

export async function checkCoupon(code, subtotal, phone) {
  const { data, error } = await supabase.rpc('check_coupon', {
    p_code: code,
    p_subtotal: subtotal,
    p_phone: phone || null,
  })
  if (error) return { coupon: null, error: couponMessage(error) || "Couldn't check that code — try again." }
  return { coupon: { code: data.code, discount: Number(data.discount) }, error: null }
}

// How a coupon reads in the admin list: "10% off (max ৳500)" / "৳300 off".
export function describeCoupon(c) {
  const amount = c.kind === 'percent' ? `${Number(c.value)}% off` : `৳ ${Number(c.value).toLocaleString()} off`
  const cap = c.kind === 'percent' && c.max_discount ? ` (max ৳ ${Number(c.max_discount).toLocaleString()})` : ''
  const min = Number(c.min_subtotal) > 0 ? ` · orders over ৳ ${Number(c.min_subtotal).toLocaleString()}` : ''
  return amount + cap + min
}

// ---------- Admin ----------

export async function fetchCoupons() {
  const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false })
  if (error) {
    console.error('[Supabase] fetchCoupons failed:', error.message)
    return { coupons: [], error }
  }
  return { coupons: data, error: null }
}

export async function createCoupon(c) {
  const { error } = await supabase.from('coupons').insert(c)
  return { error }
}

export async function setCouponActive(code, active) {
  const { error } = await supabase.from('coupons').update({ active }).eq('code', code)
  return { error }
}

export async function deleteCoupon(code) {
  const { error } = await supabase.from('coupons').delete().eq('code', code)
  return { error }
}
