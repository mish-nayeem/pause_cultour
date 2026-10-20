// Edge Function: courier
//
// Paste into the Supabase Dashboard editor (Edge Functions → Deploy a new
// function → Via Editor), name it "courier", Deploy. Redeploy after any
// change to this file.
//
// One function, three actions:
//   { action: 'create', orderId, courier }  → books the parcel, saves the
//                                             consignment id on the order
//   { action: 'status', orderId }           → asks the courier where it is,
//                                             saves what it says
//   { action: 'check' }                     → which couriers have keys set,
//                                             and whether those keys work
//
// Admin only. The courier's credentials live here as secrets and never touch
// the browser, which is the whole reason this isn't done from the admin panel
// directly.
//
// ─────────────────────────────────────────────────────────────────────────
// Secrets (Edge Functions → Secrets), only for the courier you use:
//
//   Steadfast — READY. Panel → API → copy both keys.
//     STEADFAST_API_KEY, STEADFAST_SECRET_KEY
//     STEADFAST_BASE_URL (optional, default https://portal.packzy.com/api/v1)
//
//   Pathao — READY. Merchant panel → Developer API → credentials.
//     PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME (login
//     email), PATHAO_PASSWORD, PATHAO_STORE_ID
//     PATHAO_BASE_URL (optional, default https://api-hermes.pathao.com)
//
//   RedX — not built yet: every parcel needs RedX's own area id, which
//     needs an area picker first.
//
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
  // Proves the keys work, with a line worth showing ("Connected · …").
  check?(): Promise<string>
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

// Couriers want an 11-digit local number: 01XXXXXXXXX, no +88.
function localPhone(phone: string): string {
  const d = String(phone ?? '').replace(/[^0-9]/g, '')
  return d.startsWith('880') ? d.slice(2) : d.startsWith('88') && d.length === 13 ? d.slice(2) : d
}

function itemsLine(order: Order): string {
  return (order.order_items ?? []).map((it) => `${it.product_name} ${it.size}x${it.qty}`).join(', ')
}

function pieces(order: Order): number {
  return (order.order_items ?? []).reduce((n, it) => n + Number(it.qty), 0) || 1
}

// ---- Steadfast ----
// https://portal.packzy.com/api/v1 — two headers, no token dance.
function steadfastKeys() {
  const key = env('STEADFAST_API_KEY')
  const secret = env('STEADFAST_SECRET_KEY')
  const base = (env('STEADFAST_BASE_URL') ?? 'https://portal.packzy.com/api/v1').replace(/\/+$/, '')
  if (!key || !secret) notConfigured('steadfast')
  return { base, headers: { 'Api-Key': key!, 'Secret-Key': secret!, 'Content-Type': 'application/json' } }
}

// Steadfast can answer 200 with { status: 400, errors } inside.
function steadfastRefused(json: any): never {
  const why = json?.errors ? JSON.stringify(json.errors) : json?.message ?? 'refused'
  throw new Error(`COURIER_SAID:${String(why).slice(0, 300)}`)
}

// ---- Pathao ----
// Every call needs a token issued from the merchant's own login first.
function pathaoBase(): string {
  return (env('PATHAO_BASE_URL') ?? 'https://api-hermes.pathao.com').replace(/\/+$/, '')
}

async function pathaoToken(): Promise<string> {
  const client_id = env('PATHAO_CLIENT_ID')
  const client_secret = env('PATHAO_CLIENT_SECRET')
  const username = env('PATHAO_USERNAME')
  const password = env('PATHAO_PASSWORD')
  if (!client_id || !client_secret || !username || !password || !env('PATHAO_STORE_ID')) notConfigured('pathao')

  const res = await fetch(`${pathaoBase()}/aladdin/api/v1/issue-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id, client_secret, username, password, grant_type: 'password' }),
  })
  if (!res.ok) await readCourierError(res)
  const json = await res.json()
  if (!json?.access_token) throw new Error('COURIER_SAID:Pathao gave no token — check the username and password')
  return json.access_token
}

const providers: Record<string, Provider> = {
  steadfast: {
    async createParcel(order) {
      const { base, headers } = steadfastKeys()

      const res = await fetch(`${base}/create_order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          invoice: order.id,
          recipient_name: order.customer_name,
          recipient_phone: localPhone(order.customer_phone),
          recipient_address: `${order.customer_address}, ${order.customer_area}`.slice(0, 250),
          // What the rider collects, never the order value — the bKash
          // advance has already been paid and must not be charged twice.
          cod_amount: codAmount(order),
          note: parcelNote(order),
          item_description: itemsLine(order).slice(0, 250),
          total_lot: pieces(order),
        }),
      })

      if (!res.ok) await readCourierError(res)

      const json = await res.json()
      if (json?.status && Number(json.status) !== 200) steadfastRefused(json)

      const id = json?.consignment?.consignment_id ?? json?.consignment_id
      if (!id) throw new Error('COURIER_SAID:no consignment id in the response')

      return String(id)
    },

    async fetchStatus(consignmentId) {
      const { base, headers } = steadfastKeys()

      const res = await fetch(`${base}/status_by_cid/${encodeURIComponent(consignmentId)}`, { headers })
      if (!res.ok) await readCourierError(res)

      const json = await res.json()
      return String(json?.delivery_status ?? json?.status ?? 'unknown')
    },

    // The cheapest call that proves the keys: the account balance.
    async check() {
      const { base, headers } = steadfastKeys()
      const res = await fetch(`${base}/get_balance`, { headers })
      if (!res.ok) await readCourierError(res)
      const json = await res.json()
      if (json?.status && Number(json.status) !== 200) steadfastRefused(json)
      return `Connected · balance ৳${json?.current_balance ?? 0}`
    },
  },

  pathao: {
    async createParcel(order) {
      const token = await pathaoToken()

      const res = await fetch(`${pathaoBase()}/aladdin/api/v1/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          store_id: Number(env('PATHAO_STORE_ID')),
          merchant_order_id: order.id,
          recipient_name: order.customer_name,
          recipient_phone: localPhone(order.customer_phone),
          // Pathao reads the city and zone from the address when they
          // aren't sent as ids.
          recipient_address: `${order.customer_address}, ${order.customer_area}`.slice(0, 220),
          delivery_type: 48, // normal delivery
          item_type: 2, // parcel
          special_instruction: parcelNote(order),
          item_quantity: pieces(order),
          item_weight: 0.5,
          item_description: itemsLine(order).slice(0, 250),
          amount_to_collect: codAmount(order),
        }),
      })

      if (!res.ok) await readCourierError(res)

      const json = await res.json()
      const id = json?.data?.consignment_id
      if (!id) throw new Error(`COURIER_SAID:${json?.message ?? 'no consignment id in the response'}`)

      return String(id)
    },

    async fetchStatus(consignmentId) {
      const token = await pathaoToken()
      const res = await fetch(`${pathaoBase()}/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) await readCourierError(res)
      const json = await res.json()
      return String(json?.data?.order_status ?? 'unknown')
    },

    async check() {
      const token = await pathaoToken()
      const res = await fetch(`${pathaoBase()}/aladdin/api/v1/stores`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) await readCourierError(res)
      const json = await res.json()
      const stores = json?.data?.data ?? []
      const mine = stores.find((st: any) => String(st.store_id) === env('PATHAO_STORE_ID'))
      if (!mine) throw new Error(`COURIER_SAID:Logged in, but store ${env('PATHAO_STORE_ID')} isn't one of this account's stores`)
      return `Connected · store "${mine.store_name}"`
    },
  },

  redx: {
    async createParcel(_order) {
      // Every RedX parcel needs RedX's own delivery_area_id — which needs an
      // area picker on the order first. Not built yet.
      notConfigured('redx')
    },

    async fetchStatus(_consignmentId) {
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

    // ---- check ----
    // Each courier: are its keys set, and does it answer with them.
    if (action === 'check') {
      const result: Record<string, { ok: boolean; message: string }> = {}
      for (const [key, provider] of Object.entries(providers)) {
        if (!provider.check) {
          result[key] = { ok: false, message: 'NOT_BUILT' }
          continue
        }
        try {
          result[key] = { ok: true, message: await provider.check() }
        } catch (e) {
          result[key] = { ok: false, message: String((e as Error)?.message ?? e) }
        }
      }
      return json({ couriers: result })
    }

    if (!orderId || typeof orderId !== 'string') {
      return json({ error: 'orderId is required' }, 400)
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

    return json({ error: 'action must be create, status or check' }, 400)
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
