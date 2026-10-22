import { supabase } from './supabaseClient.js'

// A signed-in customer's own side of the shop: their saved details and
// their orders. See supabase-migration-customer-accounts.sql.

export const PROFILE_FIELDS = ['name', 'phone', 'district', 'thana', 'postcode', 'address']

// The saved details, or null if there aren't any yet (or the table isn't
// there yet — the Account page and checkout simply carry on without).
export async function fetchProfile(userId) {
  if (!userId) return { profile: null, error: null }
  const { data, error } = await supabase
    .from('customer_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.warn('[Account] fetchProfile failed:', error.message)
    return { profile: null, error }
  }
  return { profile: data, error: null }
}

// Saves whatever is filled in; an empty field doesn't wipe a saved one
// unless `replace` (the Account page's own form, where clearing is meant).
export async function saveProfile(user, fields, { replace = false } = {}) {
  if (!user?.id) return { error: null }
  const row = { user_id: user.id, email: user.email, updated_at: new Date().toISOString() }
  for (const k of PROFILE_FIELDS) {
    const v = String(fields[k] ?? '').trim()
    if (v || replace) row[k] = v || null
  }
  const { error } = await supabase.from('customer_profiles').upsert(row, { onConflict: 'user_id' })
  if (error) console.warn('[Account] saveProfile failed:', error.message)
  return { error }
}

export async function fetchMyOrders() {
  const { data, error } = await supabase.rpc('my_orders')
  if (error) {
    console.warn('[Account] my_orders failed:', error.message)
    return { orders: [], error }
  }
  return { orders: Array.isArray(data) ? data : [], error: null }
}

// Admin → Customers → Accounts.
export async function fetchCustomerAccounts() {
  const { data, error } = await supabase.rpc('admin_customer_accounts')
  if (error) {
    console.error('[Admin] admin_customer_accounts failed:', error.message)
    const missing = /admin_customer_accounts|function .* does not exist/i.test(error.message || '')
    return { accounts: [], error: missing ? 'Run supabase-migration-customer-accounts.sql in Supabase first.' : "Couldn't load accounts." }
  }
  return { accounts: Array.isArray(data) ? data : [], error: null }
}
