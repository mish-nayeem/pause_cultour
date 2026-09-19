import { supabase } from './supabaseClient.js'

// Every review for a product, newest first — the star average and the list
// behind the reviews icon both come from this one query.
export async function fetchReviews(productId) {
  const { data, error } = await supabase
    .from('product_reviews')
    .select('id, customer_name, rating, comment, created_at')
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
