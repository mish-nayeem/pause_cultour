import { supabase } from './supabaseClient.js'

// Both helpers deliberately swallow errors. By the time either runs, the order
// is already saved in Supabase — an email problem must never surface to the
// customer as a failed checkout, or to the admin as a failed status change.

export async function sendOrderConfirmation(orderId) {
  try {
    const { data, error } = await supabase.functions.invoke('send-order-confirmation', {
      body: { orderId },
    })

    if (error) {
      console.warn('[Email] send-order-confirmation failed:', error.message)
      return { sent: null }
    }

    return data
  } catch (err) {
    console.warn('[Email] send-order-confirmation unreachable:', err.message)
    return { sent: null }
  }
}

export async function sendStatusUpdate(orderId, status) {
  try {
    const { data, error } = await supabase.functions.invoke('send-status-update', {
      body: { orderId, status },
    })

    if (error) {
      console.warn('[Email] send-status-update failed:', error.message)
      return { sent: false }
    }

    return data
  } catch (err) {
    console.warn('[Email] send-status-update unreachable:', err.message)
    return { sent: false }
  }
}
