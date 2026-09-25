// Edge Function: send-order-confirmation
//
// Paste this whole file into the Supabase Dashboard editor
// (Edge Functions → send-order-confirmation → Edit), then click Deploy.
// This replaces the earlier version, which only knew about `subtotal` and so
// told every customer their COD total was the product price — no delivery
// charge, and no credit for an outside-Dhaka bKash advance.
//
// Called right after checkout. Takes only an orderId and reads everything else
// back out of the database with the service role key — the request body is
// never trusted for email addresses or amounts. That matters because this
// endpoint is callable by anonymous customers; if it accepted a recipient and
// body from the caller, it would be an open mail relay.
//
// Secrets needed (Edge Functions → Secrets):
//   BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME, ADMIN_NOTIFY_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as Sentry from 'npm:@sentry/deno@^8'

// defaultIntegrations: false — the Deno SDK doesn't instrument Deno.serve,
// so without this, scope from one request could bleed into another if the
// isolate is reused. No DSN set (SENTRY_DSN secret missing) makes every call
// below a safe no-op.
Sentry.init({ dsn: Deno.env.get('SENTRY_DSN'), defaultIntegrations: false })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

function taka(n: number): string {
  return '৳ ' + Number(n).toLocaleString('en-US')
}

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface OrderItem {
  product_name: string
  size: string
  price: number
  qty: number
}

function itemRows(items: OrderItem[]): string {
  return items
    .map(
      (it) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #C9C6BA;font-size:14px;color:#16160F;">
          ${escapeHtml(it.product_name)}
          <span style="color:#8B8A82;">· ${escapeHtml(it.size)} × ${Number(it.qty)}</span>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #C9C6BA;font-size:14px;color:#16160F;text-align:right;white-space:nowrap;">
          ${taka(it.price * it.qty)}
        </td>
      </tr>`
    )
    .join('')
}

// One line of the money breakdown. `strong` is for the figure that matters
// most in that mail — what the rider collects.
function totalRow(label: string, value: string, strong = false): string {
  const weight = strong ? 'bold' : 'normal'
  const size = strong ? '16px' : '14px'

  return `
    <tr>
      <td style="padding:${strong ? '14px' : '8px'} 0 0;font-size:13px;letter-spacing:${
        strong ? '1px' : '0'
      };color:${strong ? '#16160F' : '#8B8A82'};font-weight:${weight};">
        ${escapeHtml(label)}
      </td>
      <td style="padding:${
        strong ? '14px' : '8px'
      } 0 0;font-size:${size};color:#16160F;text-align:right;font-weight:${weight};white-space:nowrap;">
        ${value}
      </td>
    </tr>`
}

// The money part of the mail, built from whatever the order row actually has.
// Orders taken before delivery charges existed have no delivery_fee, and they
// still have to read correctly — for those, the subtotal IS the total.
function moneyRows(order: Record<string, unknown>, items: OrderItem[]): string {
  const subtotal = Number(order.subtotal)
  const advance = Number(order.advance_amount ?? 0)
  const total = order.total === null || order.total === undefined
    ? subtotal
    : Number(order.total)

  // delivery_zone is the marker for "this order was taken after delivery
  // charges existed". delivery_fee can't be: it was added with a default of 0,
  // which every pre-existing row picked up, so an old order would otherwise
  // read as one with free delivery.
  if (!order.delivery_zone) {
    return itemRows(items) + totalRow('TOTAL DUE ON DELIVERY', taka(subtotal), true)
  }

  const fee = Number(order.delivery_fee ?? 0)
  const zone = order.delivery_zone === 'inside' ? 'Inside Dhaka' : 'Outside Dhaka'

  let rows =
    itemRows(items) +
    totalRow('Subtotal', taka(subtotal)) +
    totalRow(`Delivery · ${zone}`, taka(fee)) +
    totalRow('Order total', taka(total))

  if (advance > 0) {
    rows +=
      totalRow(
        `Advance paid by bKash${
          order.advance_trx_id ? ` · ${escapeHtml(order.advance_trx_id)}` : ''
        }`,
        `− ${taka(advance)}`
      ) + totalRow('DUE ON DELIVERY', taka(total - advance), true)
  } else {
    rows += totalRow('DUE ON DELIVERY', taka(total), true)
  }

  return rows
}

// Wraps content in the Pause email shell — same paper/ink palette as the site.
function shell(eyebrow: string, body: string): string {
  return `
  <div style="background:#EDEAE1;padding:32px 20px;font-family:Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;">
      <div style="font-size:28px;font-weight:bold;letter-spacing:0.5px;color:#16160F;">PAUSE</div>
      <div style="font-size:11px;letter-spacing:1.5px;color:#8B8A82;margin-top:4px;">
        ${escapeHtml(eyebrow)}
      </div>
      ${body}
      <div style="margin-top:32px;padding-top:18px;border-top:1px solid #C9C6BA;font-size:11px;color:#8B8A82;line-height:1.6;">
        Questions? Reply to this email with your order number.<br>
        PAUSE · Dhaka, BD
      </div>
    </div>
  </div>`
}

async function sendMail(params: {
  to: { email: string; name?: string }[]
  subject: string
  html: string
}): Promise<void> {
  const apiKey = Deno.env.get('BREVO_API_KEY')
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL')
  const fromName = Deno.env.get('BREVO_FROM_NAME') ?? 'Pause'

  if (!apiKey || !fromEmail) {
    throw new Error('BREVO_API_KEY or BREVO_FROM_EMAIL is not set')
  }

  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: params.to,
      subject: params.subject,
      htmlContent: params.html,
    }),
  })

  if (!res.ok) {
    throw new Error(`Brevo ${res.status}: ${await res.text()}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId } = await req.json()

    if (!orderId || typeof orderId !== 'string') {
      return new Response(JSON.stringify({ error: 'orderId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: order, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single()

    if (error || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const items: OrderItem[] = order.order_items ?? []
    const advance = Number(order.advance_amount ?? 0)
    const total = order.total === null || order.total === undefined
      ? Number(order.subtotal)
      : Number(order.total)
    const due = total - advance
    const sent = { customer: false, admin: false }

    // ---- Customer confirmation (only if they left an email) ----
    if (order.customer_email) {
      const body = `
        <div style="margin:28px 0 6px;font-size:22px;color:#16160F;">
          Thanks, ${escapeHtml(order.customer_name)}.
        </div>
        <div style="font-size:14px;line-height:1.6;color:#3a3a30;">
          ${
            advance > 0
              ? "We've got your order and your bKash advance. We'll check the transaction and call to confirm — the rest is paid in cash when the parcel arrives."
              : "We've got your order and we're getting it ready. You'll pay in cash when it arrives — nothing to do until then."
          }
        </div>

        <div style="margin:26px 0 8px;font-size:11px;letter-spacing:1.2px;color:#8B8A82;">
          ORDER ${escapeHtml(order.id)}
        </div>

        <table style="width:100%;border-collapse:collapse;border-top:1px solid #C9C6BA;">
          ${moneyRows(order, items)}
        </table>

        <div style="margin:28px 0 8px;font-size:11px;letter-spacing:1.2px;color:#8B8A82;">
          DELIVERING TO
        </div>
        <div style="font-size:14px;line-height:1.6;color:#16160F;">
          ${escapeHtml(order.customer_address)}<br>
          <span style="color:#8B8A82;">${escapeHtml(order.customer_area)}</span><br>
          <span style="color:#8B8A82;">${escapeHtml(order.customer_phone)}</span>
        </div>`

      try {
        await sendMail({
          to: [{ email: order.customer_email, name: order.customer_name }],
          subject: `Order ${order.id} confirmed — PAUSE`,
          html: shell('ORDER CONFIRMED', body),
        })
        sent.customer = true
      } catch (err) {
        console.error('[Brevo] customer confirmation failed:', err.message)
      }
    }

    // ---- Admin alert (always, so no order goes unnoticed) ----
    const adminEmail = Deno.env.get('ADMIN_NOTIFY_EMAIL')

    if (adminEmail) {
      const adminBody = `
        <div style="margin:24px 0 10px;font-size:18px;color:#16160F;">
          New order ${escapeHtml(order.id)}
        </div>
        <div style="font-size:14px;color:#3a3a30;line-height:1.7;">
          <strong>${escapeHtml(order.customer_name)}</strong><br>
          ${escapeHtml(order.customer_phone)}${
            order.customer_email ? ` · ${escapeHtml(order.customer_email)}` : ''
          }<br>
          ${escapeHtml(order.customer_address)}<br>
          ${escapeHtml(order.customer_area)}
          ${order.customer_note ? `<br><em>Note: ${escapeHtml(order.customer_note)}</em>` : ''}
        </div>
        ${
          advance > 0
            ? `<div style="margin-top:16px;padding:12px 14px;border:1px solid #16160F;font-size:13px;color:#16160F;line-height:1.6;">
                 <strong>Check the bKash advance</strong><br>
                 ${taka(advance)} · TRXID ${escapeHtml(order.advance_trx_id ?? '—')}
               </div>`
            : ''
        }
        <table style="width:100%;border-collapse:collapse;margin-top:18px;border-top:1px solid #C9C6BA;">
          ${moneyRows(order, items)}
        </table>`

      try {
        await sendMail({
          to: [{ email: adminEmail }],
          subject: `New order ${order.id} · ${taka(due)} to collect`,
          html: shell('NEW ORDER', adminBody),
        })
        sent.admin = true
      } catch (err) {
        console.error('[Brevo] admin alert failed:', err.message)
      }
    }

    // 200 even when a send fails — the order is already saved, and a mail
    // problem must never make the customer think checkout broke.
    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-order-confirmation]', err.message)
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
