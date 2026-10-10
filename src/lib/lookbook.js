import { supabase } from './supabaseClient.js'

// Drop lookbooks: one row per photo (a "look"), made in Admin → Lookbook.

// Drop names are typed in more than one place (a product's Drop field, the
// DROPS menu), so "Pause University" and "PAUSE UNIVERSITY " are the same drop.
export function dropKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

// Public read — RLS only returns visible looks; in the admin's order. Matched
// on dropKey rather than the exact spelling.
export async function fetchLooks(drop) {
  const { data, error } = await supabase
    .from('lookbook_looks')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchLooks failed:', error.message)
    return { looks: [], error }
  }
  return { looks: data.filter((l) => dropKey(l.drop_name) === dropKey(drop)), error: null }
}

// Admin read — every drop, hidden looks included.
export async function fetchAllLooks() {
  const { data, error } = await supabase
    .from('lookbook_looks')
    .select('*')
    .order('drop_name', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchAllLooks failed:', error.message)
    return { looks: [], error }
  }
  return { looks: data, error: null }
}

export async function createLook(look) {
  const { error } = await supabase.from('lookbook_looks').insert(look)
  if (error) console.error('[Supabase] createLook failed:', error.message)
  return { error }
}

export async function updateLook(id, patch) {
  const { error } = await supabase.from('lookbook_looks').update(patch).eq('id', id)
  if (error) console.error('[Supabase] updateLook failed:', error.message)
  return { error }
}

export async function deleteLook(id) {
  const { error } = await supabase.from('lookbook_looks').delete().eq('id', id)
  if (error) console.error('[Supabase] deleteLook failed:', error.message)
  return { error }
}

// Writes every look's position, so a half-finished reorder can't leave two
// looks on the same spot.
export async function reorderLooks(looks) {
  const results = await Promise.all(
    looks.map((l, i) => supabase.from('lookbook_looks').update({ sort_order: i }).eq('id', l.id))
  )
  const failed = results.find((r) => r.error)
  if (failed) console.error('[Supabase] reorderLooks failed:', failed.error.message)
  return { error: failed?.error || null }
}

export function lookbookPath(drop) {
  return `/lookbook/${encodeURIComponent(drop)}`
}
