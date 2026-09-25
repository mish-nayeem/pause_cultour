// Edge Function: track-order
//
// Paste this whole file into the Supabase Dashboard editor
// (Edge Functions → Deploy a new function → Via Editor), name the function
// "track-order", then click Deploy function.
//
// Looks up one order for a customer. Two deliberate choices here:
//
// 1. It runs as an edge function instead of a public select policy on `orders`.
//    A policy would let anyone with the anon key read every order in the table.
// 2. It requires the phone number as well as the order id. Ids are PC/PM plus
//    ten random digits (see supabase-migration-secure-order-id.sql) — without
//    the second factor, a stranger who somehow guessed one could still read
//    that customer's name, address and phone number.
//
// It returns only what the customer needs to see — no address, no note.
//
// Secrets needed: none beyond the ones Supabase provides automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Customers type their number in all sorts of ways — with spaces, with +880,
// with a leading zero. Comparing only the last nine digits makes those match.
function normalisePhone(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(-9)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, phone } = await req.json()

    if (!orderId || !phone) {
      return json({ error: 'Order number and phone are both required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, status, subtotal, created_at, customer_name, customer_phone, customer_area, order_items(product_name, size, qty, price)')
      .eq('id', String(orderId).trim().toUpperCase())
      .maybeSingle()

    // The same message for "no such order" and "wrong phone", so the response
    // can't be used to work out which order numbers exist.
    const notFound = { error: "We couldn't find an order with those details." }

    if (error || !order) return json(notFound, 404)

    if (normalisePhone(order.customer_phone) !== normalisePhone(phone)) {
      return json(notFound, 404)
    }

    return json({
      order: {
        id: order.id,
        status: order.status,
        subtotal: order.subtotal,
        placedAt: order.created_at,
        name: order.customer_name,
        area: order.customer_area,
        items: order.order_items ?? [],
      },
    })
  } catch (err) {
    console.error('[track-order]', err.message)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})
