import { supabase } from './supabaseClient.js'

// Public read — RLS only returns the visible blocks, in page order.
export async function fetchAboutBlocks() {
  const { data, error } = await supabase
    .from('about_blocks')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchAboutBlocks failed:', error.message)
    return { blocks: [], error }
  }

  return { blocks: data, error: null }
}

// Admin read — the signed-in policy returns hidden blocks too.
export async function fetchAllAboutBlocks() {
  const { data, error } = await supabase
    .from('about_blocks')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchAllAboutBlocks failed:', error.message)
    return { blocks: [], error }
  }

  return { blocks: data, error: null }
}

export async function createAboutBlock({ imageUrl, description, sortOrder }) {
  const { error } = await supabase.from('about_blocks').insert({
    image_url: imageUrl,
    description,
    sort_order: sortOrder,
  })

  if (error) {
    console.error('[Supabase] createAboutBlock failed:', error.message)
    return { error }
  }

  return { error: null }
}

export async function updateAboutBlock(id, patch) {
  const { error } = await supabase.from('about_blocks').update(patch).eq('id', id)

  if (error) {
    console.error('[Supabase] updateAboutBlock failed:', error.message)
    return { error }
  }

  return { error: null }
}

export async function deleteAboutBlock(id) {
  const { error } = await supabase.from('about_blocks').delete().eq('id', id)

  if (error) {
    console.error('[Supabase] deleteAboutBlock failed:', error.message)
    return { error }
  }

  return { error: null }
}

// Writes every row's sort_order rather than swapping two, because a partial
// failure mid-swap would leave two blocks claiming the same position.
export async function reorderAboutBlocks(blocks) {
  const updates = blocks.map((b, i) =>
    supabase.from('about_blocks').update({ sort_order: i }).eq('id', b.id)
  )

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)

  if (failed) {
    console.error('[Supabase] reorderAboutBlocks failed:', failed.error.message)
    return { error: failed.error }
  }

  return { error: null }
}
