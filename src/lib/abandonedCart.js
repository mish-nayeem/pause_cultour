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
//
// Goes through the save_abandoned_cart function rather than the table: the
// visitor can't read abandoned_carts, and without that Postgres refuses the
// upsert this used to be (see supabase-migration-abandoned-cart-rpc.sql).
// supabase-js hands errors back instead of throwing, so they're read here.
export async function saveAbandonedCart({ name, phone, items, cartValue }) {
  if (!items || items.length === 0) return

  const { error } = await supabase.rpc('save_abandoned_cart', {
    p_session_id: getSessionId(),
    p_name: name || null,
    p_phone: phone || null,
    p_items: items,
    p_cart_value: cartValue,
  })

  if (error) console.warn('[AbandonedCart] save failed:', error.message)
}

// Called right after a real order goes through, so this session's draft
// stops reading as lost. The session id is then dropped, so the next cart
// this browser starts is tracked as a new one instead of hiding under an
// order that's already been placed.
export async function markCartConverted(orderId) {
  const { error } = await supabase.rpc('mark_cart_converted', {
    p_session_id: getSessionId(),
    p_order_id: orderId,
  })

  if (error) console.warn('[AbandonedCart] convert failed:', error.message)

  try {
    localStorage.removeItem(KEY)
  } catch {
    // Storage blocked — there was no saved id to clear.
  }
}
