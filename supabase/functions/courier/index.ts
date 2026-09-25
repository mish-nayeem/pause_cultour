// Edge Function: courier
//
// Paste into the Supabase Dashboard editor (Edge Functions → Deploy a new
// function → Via Editor), name it "courier", Deploy.
//
// One function, two actions:
//   { action: 'create', orderId, courier }  → books the parcel, saves the
//                                             consignment id on the order
//   { action: 'status', orderId }           → asks the courier where it is,
//                                             saves what it says
//
// Admin only. The courier's credentials live here as secrets and never touch
// the browser, which is the whole reason this isn't done from the admin panel
// directly.
//
// ─────────────────────────────────────────────────────────────────────────
// THE INTEGRATION ITSELF IS NOT WRITTEN YET.
//
// Each provider below has two holes marked TODO: the request to send, and how
// to read the answer. Everything around them — auth, reading the order,
// writing the consignment id back, error wording the admin panel understands
// — is done. Filling in one provider is a few lines against its own docs, and
// nothing else in the app has to change.
//
// Secrets, once you have them (only the provider you actually use):
//   STEADFAST_API_KEY, STEADFAST_SECRET_KEY, STEADFAST_BASE_URL
//   PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME,
//     PATHAO_PASSWORD, PATHAO_STORE_ID, PATHAO_BASE_URL
//   REDX_ACCESS_TOKEN, REDX_BASE_URL
//   ADMIN_EMAIL (already set)
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as Sentry from 'npm:@sentry/deno@^8'

// defaultIntegrations: false — the Deno SDK doesn't instrument Deno.serve,
// so without this, scope (tags, context) from one request could bleed into
// another if the isolate is reused. No DSN set (SENTRY_DSN secret missing)
// makes every call below a safe no-op.
Sentry.init({ dsn: Deno.env.get('SENTRY_DSN'), defaultIntegrations: false })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface OrderItem {
  product_name: string
  size: string
  qty: number
}

interface Order {
  id: string
  customer_name: string
  customer_phone: string
  customer_address: string
  customer_area: string
  customer_note: string | null
  subtotal: number
  total: number | null
  delivery_fee: number | null
  advance_amount: number | null
  advance_trx_id: string | null
  courier: string | null
  consignment_id: string | null
  order_items: OrderItem[] | null
}

// What the rider has to collect at the door: the order less anything already
// paid by bKash. Getting this wrong means the customer is charged twice, so it
// is computed here rather than trusted from the caller.
function codAmount(order: Order): number {
  const total = order.total === null || order.total === undefined
    ? Number(order.subtotal)
    : Number(order.total)

  return Math.max(0, total - Number(order.advance_amount ?? 0))
}

// Couriers take structured fields — a name, a phone, an address, a number to
// collect — and exactly one free-text field. So what can't be a field goes
// here: what is in the bag, and what has already been paid. That way the
// courier's own panel shows enough to answer a customer's call without anyone
// opening our admin.
function parcelNote(order: Order): string {
  const parts: string[] = []

  const items = (order.order_items ?? [])
    .map((it) => `${it.product_name} ${it.size}x${it.qty}`)
    .join(', ')

  if (items) parts.push(items)

  const advance = Number(order.advance_amount ?? 0)

  if (advance > 0) {
    parts.push(
      `Advance ${advance} paid by bKash${
        order.advance_trx_id ? ` (${order.advance_trx_id})` : ''
      } - collect ${codAmount(order)} only`
    )
  }

  if (order.customer_note) parts.push(`Customer: ${order.customer_note}`)

  // These note fields are short — 255 characters is the usual ceiling, and a
  // rejected parcel over a long note would be a silly way to lose an order.
  const note = parts.join(' | ')
  return note.length > 250 ? `${note.slice(0, 247)}...` : note
}

function env(name: string): string | undefined {
  const value = Deno.env.get(name)
  return value && value.trim() ? value.trim() : undefined
}

interface Provider {
  // Books the parcel and returns the courier's tracking number.
  createParcel(order: Order): Promise<string>
  // Returns the courier's own wording for where the parcel is.
  fetchStatus(consignmentId: string): Promise<string>
}

// Thrown when a provider has no keys yet — the admin panel turns this into
// "That courier has no API keys set yet" rather than a stack trace.
function notConfigured(which: string): never {
  throw new Error(`NOT_CONFIGURED:${which}`)
}

// Every provider reports a refusal the same way, so the panel can quote it.
async function readCourierError(res: Response): Promise<never> {
  const text = await res.text()
  throw new Error(`COURIER_SAID:${res.status} ${text.slice(0, 300)}`)
}

const providers: Record<string, Provider> = {
  steadfast: {
    async createParcel(order) {
      const key = env('STEADFAST_API_KEY')
      const secret = env('STEADFAST_SECRET_KEY')
      const base = env('STEADFAST_BASE_URL')

      if (!key || !secret || !base) notConfigured('steadfast')

      // TODO(steadfast): the create-order call from their docs. The shape is
      // roughly the one below — confirm the path and field names against the
      // panel's API page before trusting it.
      const res = await fetch(`${base}/create_order`, {
        method: 'POST',
        headers: {
          'Api-Key': key,
          'Secret-Key': secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoice: order.id,
          recipient_name: order.customer_name,
          recipient_phone: order.customer_phone,
          recipient_address: `${order.customer_address}, ${order.customer_area}`,
          // What the rider collects, never the order value — the bKash
          // advance has already been paid and must not be charged twice.
          cod_amount: codAmount(order),
          note: parcelNote(order),
          item_description: (order.order_items ?? [])
            .map((it) => `${it.product_name} ${it.size}x${it.qty}`)
            .join(', '),
          total_lot: (order.order_items ?? []).reduce((n, it) => n + Number(it.qty), 0),
        }),
      })

      if (!res.ok) await readCourierError(res)

      const json = await res.json()

      // TODO(steadfast): point this at wherever the tracking number really is.
      const id = json?.consignment?.consignment_id ?? json?.consignment_id
      if (!id) throw new Error('COURIER_SAID:no consignment id in the response')

      return String(id)
    },

    async fetchStatus(consignmentId) {
      const key = env('STEADFAST_API_KEY')
      const secret = env('STEADFAST_SECRET_KEY')
      const base = env('STEADFAST_BASE_URL')

      if (!key || !secret || !base) notConfigured('steadfast')

      // TODO(steadfast): their status-by-consignment endpoint.
      const res = await fetch(`${base}/status_by_cid/${consignmentId}`, {
        headers: { 'Api-Key': key, 'Secret-Key': secret },
      })

      if (!res.ok) await readCourierError(res)

      const json = await res.json()
      return String(json?.delivery_status ?? json?.status ?? 'unknown')
    },
  },

  pathao: {
    async createParcel(_order) {
      // Pathao signs requests with a token fetched from its own issue-token
      // endpoint first, so this one needs two calls, not one.
      // TODO(pathao): issue a token with CLIENT_ID/CLIENT_SECRET/USERNAME/
      // PASSWORD, then POST the order to /aladdin/api/v1/orders with
      // PATHAO_STORE_ID, and return the consignment_id it answers with.
      notConfigured('pathao')
    },

    async fetchStatus(_consignmentId) {
      // TODO(pathao): same token, then the order-detail endpoint.
      notConfigured('pathao')
    },
  },

  redx: {
    async createParcel(_order) {
      // TODO(redx): POST /v1/parcels with the REDX_ACCESS_TOKEN as a bearer
      // token; the tracking id comes back as `tracking_id`.
      notConfigured('redx')
    },

    async fetchStatus(_consignmentId) {
      // TODO(redx): GET /v1/parcels/track/{trackingId}.
      notConfigured('redx')
    },
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { action, orderId, courier } = await req.json()

    if (!orderId || typeof orderId !== 'string') {
      return json({ error: 'orderId is required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ---- Admin only ----
    // Booking parcels and reading customer addresses is not something an
    // anonymous caller gets to do, and the anon key alone is a valid JWT.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const adminEmail = (env('ADMIN_EMAIL') ?? env('ADMIN_NOTIFY_EMAIL') ?? '').toLowerCase()

    if (!adminEmail) {
      console.error('[courier] ADMIN_EMAIL is not set')
      return json({ error: 'Not configured' }, 500)
    }

    const { data: caller } = await supabase.auth.getUser(token)

    if ((caller?.user?.email ?? '').toLowerCase() !== adminEmail) {
      return json({ error: 'Not allowed' }, 403)
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return json({ error: 'Order not found' }, 404)
    }

    // ---- create ----
    if (action === 'create') {
      const key = String(courier ?? order.courier ?? '')
      const provider = providers[key]

      if (!provider) return json({ error: `Unknown courier: ${key}` }, 400)

      if (order.consignment_id) {
        // Booking the same order twice means two parcels and two collections.
        return json({ consignmentId: order.consignment_id, alreadyBooked: true })
      }

      const consignmentId = await provider.createParcel(order as Order)

      await supabase
        .from('orders')
        .update({
          courier: key,
          consignment_id: consignmentId,
          courier_status: 'booked',
          courier_synced_at: new Date().toISOString(),
        })
        .eq('id', orderId)

      return json({ consignmentId })
    }

    // ---- status ----
    if (action === 'status') {
      if (!order.consignment_id || !order.courier) {
        return json({ error: 'That order has not been sent to a courier yet' }, 400)
      }

      const provider = providers[order.courier]
      if (!provider) return json({ error: `Unknown courier: ${order.courier}` }, 400)

      const status = await provider.fetchStatus(order.consignment_id)

      await supabase
        .from('orders')
        .update({ courier_status: status, courier_synced_at: new Date().toISOString() })
        .eq('id', orderId)

      return json({ status })
    }

    return json({ error: 'action must be create or status' }, 400)
  } catch (err) {
    // NOT_CONFIGURED and COURIER_SAID are meant for the admin panel to read,
    // so they travel as-is and aren't worth an alert; anything else is a real
    // bug worth Sentry knowing about.
    const message = String(err.message ?? '')
    console.error('[courier]', message)

    if (message.startsWith('NOT_CONFIGURED') || message.startsWith('COURIER_SAID')) {
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    Sentry.captureException(err)
    // The isolate can be torn down the instant this function returns —
    // without waiting for the event to actually reach Sentry, it may never
    // arrive at all.
    await Sentry.flush(2000)

    return new Response(JSON.stringify({ error: 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
