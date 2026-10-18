import { supabase } from './supabaseClient.js'
import { fetchSetting, saveSetting } from './siteSettings.js'
import { INFO_PAGES } from '../content/info-pages.js'

// The Support page: its copy (built-in defaults from src/content/info-pages.js,
// overridden page by page from Admin → Support → Support pages) and the
// Return & Exchange Portal's two calls (supabase-migration-support.sql).

export const PAGES_KEY = 'support_pages'
export const PORTAL_KEY = 'support_portal'

export const DEFAULT_PORTAL = {
  heading: 'Return & Exchange',
  intro: 'Track your order by entering the order number and the email or phone number you ordered with.',
  image: '',
}

// Saved pages replace their default whole; a page never saved (or saved
// without any content) keeps the built-in copy.
export function mergePages(saved) {
  const out = { ...INFO_PAGES }
  if (saved && typeof saved === 'object') {
    for (const [slug, page] of Object.entries(saved)) {
      if (page && Array.isArray(page.blocks)) out[slug] = { ...INFO_PAGES[slug], ...page }
    }
  }
  return out
}

export async function fetchSupportPages() {
  const { value, error } = await fetchSetting(PAGES_KEY)
  return { pages: mergePages(value), saved: value && typeof value === 'object' ? value : {}, error }
}

export async function saveSupportPages(saved) {
  return saveSetting(PAGES_KEY, saved)
}

export async function fetchPortal() {
  const { value, error } = await fetchSetting(PORTAL_KEY)
  return { portal: { ...DEFAULT_PORTAL, ...(value && typeof value === 'object' ? value : {}) }, error }
}

export async function savePortal(portal) {
  return saveSetting(PORTAL_KEY, portal)
}

// ---------- Portal ----------

export async function findOrder(orderId, contact) {
  const { data, error } = await supabase.rpc('support_find_order', {
    p_order_id: orderId,
    p_contact: contact,
  })
  if (error) {
    console.error('[Supabase] support_find_order failed:', error.message)
    return { order: null, error: 'Something went wrong. Please try again.' }
  }
  if (!data) return { order: null, error: "We couldn't find an order with those details." }
  return { order: data, error: null }
}

export async function sendRequest({ orderId, contact, kind, reason, items, details }) {
  const { data, error } = await supabase.rpc('support_request_return', {
    p_order_id: orderId,
    p_contact: contact,
    p_kind: kind,
    p_reason: reason,
    p_items: items,
    p_details: details,
  })
  // The function's own messages ("Pick at least one item.") are written for
  // the customer, so they're shown as they are.
  if (error) return { id: null, error: error.message || 'Something went wrong. Please try again.' }
  return { id: data?.id ?? null, error: null }
}

// ---------- Admin ----------

export function isNewRequest(r) {
  return r.source === 'customer' && !r.seen_at
}

export async function markRequestsSeen(ids) {
  if (!ids.length) return { error: null }
  const { error } = await supabase
    .from('order_returns')
    .update({ seen_at: new Date().toISOString() })
    .in('id', ids)
  if (error) console.error('[Supabase] markRequestsSeen failed:', error.message)
  return { error }
}

export async function updateRequest(id, status, adminNote) {
  const done = status === 'resolved' || status === 'rejected'
  const { error } = await supabase
    .from('order_returns')
    .update({
      status,
      admin_note: adminNote || null,
      resolved_at: done ? new Date().toISOString() : null,
      seen_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) console.error('[Supabase] updateRequest failed:', error.message)
  return { error }
}
