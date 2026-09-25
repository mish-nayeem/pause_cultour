// Edge Function: send-status-update
//
// Paste this whole file into the Supabase Dashboard editor
// (Edge Functions → Deploy a new function → Via Editor), name the
// function "send-status-update", then click Deploy function.
//
// Called from the admin panel when an order's status changes, to tell the
// customer. Unlike send-order-confirmation this one requires a valid admin
// JWT: it is triggered by a human action, so there's no reason to leave it
// open, and verifying the caller keeps it from being used to spam customers.
//
// Secrets needed (Edge Functions → Secrets):
//   BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME, ADMIN_EMAIL
//   SENTRY_DSN (optional — every Sentry call below is a no-op without it)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as Sentry from 'npm:@sentry/deno@^8'

// defaultIntegrations: false — the Deno SDK doesn't instrument Deno.serve,
// so without this, scope from one request could bleed into another if the
// isolate is reused.
Sentry.init({ dsn: Deno.env.get('SENTRY_DSN'), defaultIntegrations: false })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

// Only these statuses are worth emailing about. A move back to "pending" or a
// no-op re-save shouldn't ping the customer.
const NOTIFIABLE: Record<string, { eyebrow: string; subject: string; line: string }> = {
  shipped: {
    eyebrow: 'ON THE WAY',
    subject: 'is on the way',
    line: "Your order has left us and is on its way. Please keep the cash amount below ready for the delivery rider.",
  },
  delivered: {
    eyebrow: 'DELIVERED',
    subject: 'was delivered',
    line: 'Your order has been delivered and paid. Thanks for shopping with us.',
  },
  cancelled: {
    eyebrow: 'CANCELLED',
    subject: 'was cancelled',
    line: "Your order has been cancelled and you won't be charged. If this wasn't expected, reply to this email.",
  },
}

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
    // ---- Verify the caller is the admin ----
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: userData } = await authClient.auth.getUser()
    const callerEmail = userData?.user?.email?.trim().toLowerCase()
    const adminEmail = Deno.env.get('ADMIN_EMAIL')?.trim().toLowerCase()

    if (!callerEmail || !adminEmail || callerEmail !== adminEmail) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ---- Load the order and send ----
    const { orderId, status } = await req.json()

    if (!orderId || !status) {
      return new Response(JSON.stringify({ error: 'orderId and status are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const copy = NOTIFIABLE[status]

    if (!copy) {
      return new Response(JSON.stringify({ skipped: `no email for status "${status}"` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: order, error } = await admin
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

    if (!order.customer_email) {
      return new Response(JSON.stringify({ skipped: 'no customer email on file' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const items: OrderItem[] = order.order_items ?? []
    const amountLabel = status === 'delivered' ? 'TOTAL PAID' : 'TOTAL'

    const body = `
      <div style="margin:28px 0 6px;font-size:22px;color:#16160F;">
        ${escapeHtml(order.customer_name)}, your order ${escapeHtml(copy.subject)}.
      </div>
      <div style="font-size:14px;line-height:1.6;color:#3a3a30;">
        ${copy.line}
      </div>

      <div style="margin:26px 0 8px;font-size:11px;letter-spacing:1.2px;color:#8B8A82;">
        ORDER ${escapeHtml(order.id)}
      </div>

      <table style="width:100%;border-collapse:collapse;border-top:1px solid #C9C6BA;">
        ${itemRows(items)}
        <tr>
          <td style="padding:14px 0 0;font-size:13px;letter-spacing:1px;color:#16160F;font-weight:bold;">
            ${amountLabel}
          </td>
          <td style="padding:14px 0 0;font-size:16px;color:#16160F;text-align:right;font-weight:bold;">
            ${taka(order.subtotal)}
          </td>
        </tr>
      </table>

      <div style="margin:28px 0 8px;font-size:11px;letter-spacing:1.2px;color:#8B8A82;">
        DELIVERY ADDRESS
      </div>
      <div style="font-size:14px;line-height:1.6;color:#16160F;">
        ${escapeHtml(order.customer_address)}<br>
        <span style="color:#8B8A82;">${escapeHtml(order.customer_area)}</span>
      </div>`

    try {
      await sendMail({
        to: [{ email: order.customer_email, name: order.customer_name }],
        subject: `Order ${order.id} ${copy.subject} — PAUSE`,
        html: shell(copy.eyebrow, body),
      })
    } catch (err) {
      console.error('[Brevo] status update failed:', err.message)
      return new Response(JSON.stringify({ sent: false, error: 'Send failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-status-update]', err.message)
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
