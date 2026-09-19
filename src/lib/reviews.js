import { supabase } from './supabaseClient.js'

export async function fetchReviews(productId) {
  const { data, error } = await supabase
    .from('product_reviews')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[Supabase] fetchReviews failed:', error.message)
    return { reviews: [], error }
  }
  return { reviews: data, error: null }
}

export async function submitReview({ productId, name, rating, comment }) {
  const { error } = await supabase.from('product_reviews').insert({
    product_id: productId,
    customer_name: name,
    rating,
    comment: comment?.trim() || null,
  })

  if (error) {
    console.error('[Supabase] submitReview failed:', error.message)
    return { error }
  }
  return { error: null }
}
