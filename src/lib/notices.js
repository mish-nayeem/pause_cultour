import { supabase } from './supabaseClient.js'

// Admin → Overview → Notifications: what's been checked or deleted, kept in
// admin_notice_state (supabase-migration-admin-notices.sql) so every device
// the admin uses agrees.

export const SINCE_KEY = '__since'
export const SEEN_KEY = '__seen'

// How far back the list reaches the very first time it's opened.
const FIRST_LOOK_BACK_MS = 24 * 60 * 60 * 1000

export async function fetchNoticeState() {
  const { data, error } = await supabase.from('admin_notice_state').select('*')
  if (error) {
    console.error('[Supabase] fetchNoticeState failed:', error.message)
    return { state: null, error }
  }

  const state = new Map(data.map((r) => [r.key, r]))

  // First use: start the list a day back instead of at the first order ever.
  if (!state.has(SINCE_KEY)) {
    const since = { key: SINCE_KEY, read_at: new Date(Date.now() - FIRST_LOOK_BACK_MS).toISOString() }
    await supabase.from('admin_notice_state').upsert(since)
    state.set(SINCE_KEY, since)
  }

  return { state, error: null }
}

export async function saveNotice(key, patch) {
  const { error } = await supabase.from('admin_notice_state').upsert({ key, ...patch })
  if (error) console.error('[Supabase] saveNotice failed:', error.message)
  return { error }
}

export async function saveNotices(rows) {
  if (!rows.length) return { error: null }
  const { error } = await supabase.from('admin_notice_state').upsert(rows)
  if (error) console.error('[Supabase] saveNotices failed:', error.message)
  return { error }
}

// Orders placed after `after` — the ones that came in while the panel was
// open. Only what a notification shows.
export async function fetchOrdersAfter(after) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, customer_name, total, subtotal')
    .gt('created_at', after)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return { orders: [], error }
  return { orders: data, error: null }
}
