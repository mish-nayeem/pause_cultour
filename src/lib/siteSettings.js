import { supabase } from './supabaseClient.js'

// Storefront copy kept in the site_settings table (one row per key), so the
// admin can change it without a redeploy.

export async function fetchSetting(key) {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error) {
    console.error('[Supabase] fetchSetting failed:', error.message)
    return { value: null, error }
  }
  return { value: data?.value ?? null, error: null }
}

export async function saveSetting(key, value) {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) console.error('[Supabase] saveSetting failed:', error.message)
  return { error }
}

// The homepage ticker's lines when none are saved (or the table isn't there).
export const DEFAULT_TICKER = [
  'EVERYTHING ON HOLD',
  'CUT & SEWN IN DHAKA',
  'RELEASED IN SMALL DROPS',
  "WHEN IT'S GONE, IT'S GONE",
]

export async function fetchTicker() {
  const { value } = await fetchSetting('ticker')
  const lines = Array.isArray(value) ? value.map((l) => String(l).trim()).filter(Boolean) : []
  return lines.length ? lines : DEFAULT_TICKER
}
