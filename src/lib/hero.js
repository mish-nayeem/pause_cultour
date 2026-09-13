import { supabase } from './supabaseClient.js'

// Public read — only active slides, in display order. Used by the homepage.
export async function fetchHeroSlides() {
  const { data, error } = await supabase
    .from('hero_slides')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchHeroSlides failed:', error.message)
    return { slides: [], error }
  }

  return { slides: data, error: null }
}

// Admin read — includes hidden slides, so they can be toggled back on.
export async function fetchAllHeroSlides() {
  const { data, error } = await supabase
    .from('hero_slides')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchAllHeroSlides failed:', error.message)
    return { slides: [], error }
  }

  return { slides: data, error: null }
}

export async function createHeroSlide({ label, imageUrl, sortOrder }) {
  const { error } = await supabase.from('hero_slides').insert({
    label,
    image_url: imageUrl,
    sort_order: sortOrder,
  })

  if (error) {
    console.error('[Supabase] createHeroSlide failed:', error.message)
    return { error }
  }

  return { error: null }
}

export async function updateHeroSlide(id, patch) {
  const { error } = await supabase.from('hero_slides').update(patch).eq('id', id)

  if (error) {
    console.error('[Supabase] updateHeroSlide failed:', error.message)
    return { error }
  }

  return { error: null }
}

export async function deleteHeroSlide(id) {
  const { error } = await supabase.from('hero_slides').delete().eq('id', id)

  if (error) {
    console.error('[Supabase] deleteHeroSlide failed:', error.message)
    return { error }
  }

  return { error: null }
}

// Reordering writes every row's sort_order rather than swapping two, because a
// partial failure mid-swap would leave two slides claiming the same position.
export async function reorderHeroSlides(slides) {
  const updates = slides.map((s, i) =>
    supabase.from('hero_slides').update({ sort_order: i }).eq('id', s.id)
  )

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)

  if (failed) {
    console.error('[Supabase] reorderHeroSlides failed:', failed.error.message)
    return { error: failed.error }
  }

  return { error: null }
}
