import { supabase } from './supabaseClient.js'

// Who said what stays between the reviewer and the admin panel — the
// storefront only ever needs the rating itself for the star average, so
// that's all this asks the query for. Postgrest only sends back the columns
// a query selects regardless of what RLS would otherwise allow through, so
// a name or comment never reaches the browser here at all.
export async function fetchRatingSummary(productId) {
  const { data, error } = await supabase
    .from('product_reviews')
    .select('rating')
    .eq('product_id', productId)

  if (error) {
    console.error('[Supabase] fetchRatingSummary failed:', error.message)
    return { ratings: [], error }
  }
  return { ratings: data.map((r) => r.rating), error: null }
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
