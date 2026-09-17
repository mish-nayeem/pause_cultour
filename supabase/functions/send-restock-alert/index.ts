// Edge Function: send-restock-alert
//
// Paste this whole file into the Supabase Dashboard editor
// (Edge Functions → Deploy a new function → Via Editor), name the
// function "send-restock-alert", then click Deploy function.
//
// Called from the admin panel when a size goes from 0 back to something — by
// the product form right after it saves, and by the Wishlist tab's "Email
// them" button. Takes only a productId and a size; the addresses are read out
// of the wishlist table with the service role key, so no customer email ever
// travels through the browser or the request body.
//
// Unlike send-order-confirmation, this one refuses anyone who isn't the signed
// -in admin. Customers never need to call it, and if anyone could, they could
// fire everybody's "it's back" mail whenever they liked.
//
// Rows are marked notified_at only after their mail actually goes out, so a
// failure leaves the request open and the admin can send again.
//
// Secrets needed (Edge Functions → Secrets):
//   BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME,
//   ADMIN_EMAIL (falls back to ADMIN_NOTIFY_EMAIL), SITE_URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
        You asked to hear when this came back, so this is the one email about it.<br>
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

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { productId, size } = await req.json()

    if (!productId || typeof productId !== 'string') {
      return json({ error: 'productId is required' }, 400)
    }

    // ---- Admin only ----
    // The anon key on its own is a valid JWT, so the caller's own token is
    // what gets checked here, not just that a token exists.
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const adminEmail = (
      Deno.env.get('ADMIN_EMAIL') ??
      Deno.env.get('ADMIN_NOTIFY_EMAIL') ??
      ''
    )
      .trim()
      .toLowerCase()

    if (!adminEmail) {
      console.error('[send-restock-alert] ADMIN_EMAIL is not set')
      return json({ error: 'Not configured' }, 500)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: caller } = await supabase.auth.getUser(token)
    const callerEmail = (caller?.user?.email ?? '').trim().toLowerCase()

    if (!callerEmail || callerEmail !== adminEmail) {
      return json({ error: 'Not allowed' }, 403)
    }

    // ---- Who is waiting ----
    let query = supabase
      .from('wishlist')
      .select('id, email, product_name, size')
      .eq('product_id', productId)
      .is('notified_at', null)

    // A null size means they wanted the product rather than one size of it,
    // and `.eq` would never match that row.
    query = size ? query.eq('size', size) : query.is('size', null)

    const { data: waiting, error: listError } = await query

    if (listError) {
      console.error('[send-restock-alert] wishlist read failed:', listError.message)
      return json({ error: 'Could not read the wishlist' }, 500)
    }

    if (!waiting || waiting.length === 0) {
      return json({ sent: 0 })
    }

    // Product details for the mail. Missing product isn't fatal — the wishlist
    // row carries the name it was saved under.
    const { data: product } = await supabase
      .from('products')
      .select('id, name, variant, price')
      .eq('id', productId)
      .single()

    const name = product?.name ?? waiting[0].product_name
    const siteUrl = (Deno.env.get('SITE_URL') ?? 'https://pause-cultour.vercel.app').replace(
      /\/+$/,
      ''
    )
    const link = `${siteUrl}/product/${encodeURIComponent(productId)}`

    const body = `
      <div style="margin:28px 0 6px;font-size:22px;color:#16160F;">
        ${escapeHtml(name)} is back${size ? ` in ${escapeHtml(size)}` : ''}.
      </div>
      <div style="font-size:14px;line-height:1.6;color:#3a3a30;">
        It's on the site now. These go quickly — we make them in small runs.
      </div>

      <div style="margin:24px 0 8px;font-size:11px;letter-spacing:1.2px;color:#8B8A82;">
        ${escapeHtml(product?.variant ?? '')}${
          product?.price ? ` · ${taka(product.price)}` : ''
        }
      </div>

      <a href="${link}"
         style="display:inline-block;margin-top:14px;background:#16160F;color:#EDEAE1;
                text-decoration:none;padding:14px 22px;font-size:13px;letter-spacing:1px;">
        SHOP IT
      </a>`

    const html = shell('BACK IN STOCK', body)
    const subject = size
      ? `${name} is back in ${size} — PAUSE`
      : `${name} is back — PAUSE`

    // One request per person. Brevo would take the whole list in a single
    // call, but then every recipient sees everyone else's address.
    const notified: number[] = []

    for (const row of waiting) {
      try {
        await sendMail({ to: [{ email: row.email }], subject, html })
        notified.push(row.id)
      } catch (err) {
        console.error(`[Brevo] restock alert to ${row.email} failed:`, err.message)
      }
    }

    if (notified.length > 0) {
      const { error: markError } = await supabase
        .from('wishlist')
        .update({ notified_at: new Date().toISOString() })
        .in('id', notified)

      if (markError) {
        // The mail went out; leaving the rows open would mail these people
        // again on the next restock, so it's worth shouting about in the logs.
        console.error('[send-restock-alert] could not mark notified:', markError.message)
      }
    }

    return json({ sent: notified.length, waiting: waiting.length })
  } catch (err) {
    console.error('[send-restock-alert]', err.message)
    return json({ error: 'Unexpected error' }, 500)
  }
})
