// Edge Function: send-customer-email
//
// An email the admin wrote (or edited) in the panel, sent to the customer of
// one order — Admin → Support → Requests → "Email the customer" (an
// exchange accepted: what to pay the rider, or the refund and the bKash
// number it goes to). The admin's own words go out as they are, in the
// PAUSE letter style.
//
// Body: { orderId, subject, text }
// Secrets: BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME (already set).
// Who the admin is comes from the database's is_admin().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Whether the caller is the admin — asked of the database's own is_admin(),
// the same check every admin-only table and function uses, so the admin's
// address lives in one place (a changed admin email can't lock this out).
async function callerIsAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(auth)) return false
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })
  const { data, error } = await asCaller.rpc('is_admin')
  return !error && data === true
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// The admin's text as the letter: an empty line starts a new paragraph.
function letter(text: string): string {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#16160F;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `
  <div style="background:#EDEAE1;padding:32px 20px;font-family:Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;">
      <div style="font-size:28px;font-weight:bold;letter-spacing:0.5px;color:#16160F;">PAUSE</div>
      <div style="margin-top:24px;">${paras}</div>
      <div style="margin-top:32px;padding-top:18px;border-top:1px solid #C9C6BA;font-size:11px;color:#8B8A82;line-height:1.6;">
        Questions? Reply to this email with your order number.<br>
        PAUSE · Dhaka, BD
      </div>
    </div>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!(await callerIsAdmin(req))) return json({ error: 'Not allowed' }, 403)

    const { orderId, subject, text } = await req.json().catch(() => ({}))
    if (!orderId || !String(subject || '').trim() || !String(text || '').trim()) {
      return json({ error: 'orderId, subject and text are required' }, 400)
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: o, error } = await db.from('orders').select('customer_email, customer_name').eq('id', orderId).maybeSingle()
    if (error) throw new Error(error.message)
    const email = String(o?.customer_email || '').trim()
    if (!email) return json({ error: 'This order has no email address.' }, 400)

    const apiKey = Deno.env.get('BREVO_API_KEY')
    const fromEmail = Deno.env.get('BREVO_FROM_EMAIL')
    const fromName = Deno.env.get('BREVO_FROM_NAME') ?? 'Pause'
    if (!apiKey || !fromEmail) return json({ error: 'Email is not set up (BREVO_API_KEY / BREVO_FROM_EMAIL).' }, 500)

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email, name: o?.customer_name || undefined }],
        subject: String(subject).trim().slice(0, 200),
        htmlContent: letter(String(text).slice(0, 8000)),
        textContent: String(text).slice(0, 8000),
      }),
    })
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return json({ ok: true, to: email })
  } catch (err) {
    const message = String((err as Error).message ?? err)
    console.error('[send-customer-email]', message)
    return json({ error: message }, 400)
  }
})
