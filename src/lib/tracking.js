import { supabase } from './supabaseClient.js'

// Looks up an order through the track-order edge function. The function checks
// the phone number against the order before returning anything, so a guessed
// order id on its own reveals nothing.
export async function trackOrder(orderId, phone) {
  try {
    const { data, error } = await supabase.functions.invoke('track-order', {
      body: { orderId, phone },
    })

    // A 404 from the function arrives here as an error, but it's an expected
    // outcome — not a fault worth showing as "something went wrong".
    if (error) {
      return { order: null, error: "We couldn't find an order with those details." }
    }

    if (data?.error) return { order: null, error: data.error }

    return { order: data.order, error: null }
  } catch (err) {
    console.warn('[Tracking] track-order unreachable:', err.message)
    return { order: null, error: 'Could not reach the server. Check your connection.' }
  }
}
