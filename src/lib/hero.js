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

// device: 'desktop' (PC, laptop, tablet) or 'mobile' (phones).
export async function createHeroSlide({ label, imageUrl, sortOrder, device = 'all' }) {
  const { error } = await supabase.from('hero_slides').insert({
    label,
    image_url: imageUrl,
    sort_order: sortOrder,
    device,
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

// Phones get the 'mobile' slides; PC, laptop and tablet the 'desktop' ones.
export const PHONE_QUERY = '(max-width: 767px)'

// The slides for this kind of screen ('all' slides show on both). If none
// are made for it yet, the other screen's slides stand in, so the hero is
// never left empty.
export function slidesFor(slides, isPhone) {
  const want = isPhone ? 'mobile' : 'desktop'
  const mine = slides.filter((s) => !s.device || s.device === 'all' || s.device === want)
  return mine.length ? mine : slides
}
