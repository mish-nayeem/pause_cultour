import { supabase } from './supabaseClient.js'

// A random id the browser makes for itself once and keeps in localStorage —
// there's no login on the storefront, so this is the only thing tying a
// draft checkout back to the same visitor if they come back to it.
const KEY = 'pause_cart_session'

function getSessionId() {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // Storage blocked (private mode) — a session id that doesn't persist
    // still lets this one save go through, it just won't be found again.
    return crypto.randomUUID()
  }
}

// Snapshots a checkout in progress so it shows up in the admin panel's
// Abandoned Cart list if it's never finished. The caller debounces — this
// writes on every call, no throttling of its own.
export async function saveAbandonedCart({ name, phone, items, cartValue }) {
  if (!items || items.length === 0) return

  try {
    await supabase.from('abandoned_carts').upsert({
      session_id: getSessionId(),
      customer_name: name || null,
      customer_phone: phone || null,
      items,
      cart_value: cartValue,
      last_active: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[AbandonedCart] save failed:', err.message)
  }
}

// Called right after a real order goes through, so this session's draft
// stops reading as lost.
export async function markCartConverted(orderId) {
  try {
    await supabase
      .from('abandoned_carts')
      .update({ converted_order_id: orderId })
      .eq('session_id', getSessionId())
  } catch (err) {
    console.warn('[AbandonedCart] convert failed:', err.message)
  }
}
