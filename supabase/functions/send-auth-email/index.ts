// Edge Function: send-auth-email
//
// Paste this whole file into the Supabase Dashboard editor
// (Edge Functions → Deploy a new function → name it send-auth-email).
//
// Supabase's own mailer sends "Confirm your email address" from Supabase Auth.
// This is its Send Email hook: with it switched on, Supabase hands every auth
// email (sign-up confirmation, invite, password reset) to this function
// instead, and it goes out through Brevo's HTTP API — the same one the order
// emails use, so no SMTP port is involved — from the PAUSE sender.
//
// Setup, in order:
//   1. Deploy this function, then Edge Functions → send-auth-email → Details
//      and turn OFF "Enforce JWT Verification". Supabase calls it with a
//      signed webhook, not a user token; the signature is checked below.
//   2. Authentication → Hooks → Send Email → HTTPS/Edge Function → pick this
//      function → Generate secret → Create.
//   3. Edge Functions → Secrets → add SEND_EMAIL_HOOK_SECRET with the value
//      Supabase just showed (it starts with v1,whsec_).
//   BREVO_API_KEY, BREVO_FROM_EMAIL and BREVO_FROM_NAME are the same secrets
//   send-order-confirmation already uses.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface Copy {
  subject: string
  eyebrow: string
  heading: string
  text: string
  button: string
}

// What each kind of auth mail says. Anything not listed here is refused
// rather than sent with the wrong wording.
const COPY: Record<string, Copy> = {
  signup: {
    subject: 'Confirm your PAUSE account',
    eyebrow: 'CONFIRM YOUR ACCOUNT',
    heading: 'Thanks for signing up.',
    text: "Confirm your email to finish creating your account. Once you're in, you can keep a wishlist of sold-out sizes and we'll email you the day they're back.",
    button: 'CONFIRM EMAIL',
  },
  invite: {
    subject: "You've been invited to PAUSE",
    eyebrow: 'YOU ARE INVITED',
    heading: "You've been invited.",
    text: 'Accept the invite to set up your account.',
    button: 'ACCEPT INVITE',
  },
  recovery: {
    subject: 'Reset your PAUSE password',
    eyebrow: 'RESET YOUR PASSWORD',
    heading: 'Reset your password.',
    text: "Use the button below to choose a new password. If you didn't ask for this, ignore this email.",
    button: 'RESET PASSWORD',
  },
  magiclink: {
    subject: 'Your PAUSE sign-in link',
    eyebrow: 'SIGN IN',
    heading: 'Sign in to PAUSE.',
    text: "Use the button below to sign in. If you didn't ask for this, ignore this email.",
    button: 'SIGN IN',
  },
}

function buildHtml(copy: Copy, link: string): string {
  return `
  <div style="background:#EDEAE1;padding:32px 20px;font-family:Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;">
      <div style="font-size:28px;font-weight:bold;letter-spacing:0.5px;color:#16160F;">PAUSE</div>
      <div style="font-size:11px;letter-spacing:1.5px;color:#8B8A82;margin-top:4px;">
        ${escapeHtml(copy.eyebrow)}
      </div>

      <p style="font-size:20px;line-height:1.4;color:#16160F;margin:28px 0 10px;">
        ${escapeHtml(copy.heading)}
      </p>
      <p style="font-size:15px;line-height:1.7;color:#16160F;margin:0 0 26px;">
        ${escapeHtml(copy.text)}
      </p>

      <a href="${escapeHtml(link)}"
         style="display:inline-block;background:#16160F;color:#EDEAE1;text-decoration:none;font-size:13px;letter-spacing:1.5px;padding:15px 30px;">
        ${escapeHtml(copy.button)}
      </a>

      <p style="font-size:12px;line-height:1.7;color:#8B8A82;margin:26px 0 0;">
        Button not working? Paste this link into your browser:<br>
        <span style="word-break:break-all;">${escapeHtml(link)}</span>
      </p>

      <div style="margin-top:32px;padding-top:18px;border-top:1px solid #C9C6BA;font-size:11px;color:#8B8A82;line-height:1.6;">
        Didn't ask for this? You can ignore this email — nothing changes until
        the link is opened.<br>
        PAUSE · Dhaka, BD
      </div>
    </div>
  </div>`
}

// Supabase reads a non-200 response with { error: { http_code, message } } as
// "the hook failed" and stops the sign-up with that message.
function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail(405, 'POST only')

  // The signature is what makes this safe to leave open to the internet:
  // without the shared secret nobody can get this function to send mail.
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')?.replace('v1,whsec_', '')
  if (!secret) return fail(500, 'SEND_EMAIL_HOOK_SECRET is not set')

  const payload = await req.text()
  const headers = Object.fromEntries(req.headers)

  let event: {
    user: { email: string }
    email_data: {
      token_hash: string
      redirect_to: string
      email_action_type: string
    }
  }

  try {
    event = new Webhook(secret).verify(payload, headers) as typeof event
  } catch (err) {
    console.error('[auth-email] bad signature:', (err as Error).message)
    return fail(401, 'Invalid signature')
  }

  const { user, email_data } = event
  const copy = COPY[email_data.email_action_type]
  if (!copy) {
    return fail(400, `Unsupported email type: ${email_data.email_action_type}`)
  }

  const apiKey = Deno.env.get('BREVO_API_KEY')
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL')
  const fromName = Deno.env.get('BREVO_FROM_NAME') ?? 'PAUSE'
  if (!apiKey || !fromEmail) return fail(500, 'BREVO_API_KEY or BREVO_FROM_EMAIL is not set')

  // The same link Supabase's own mailer would have built: it verifies the
  // token, then sends the person on to redirect_to (the site's /account page).
  const link =
    `${Deno.env.get('SUPABASE_URL')}/auth/v1/verify` +
    `?token=${encodeURIComponent(email_data.token_hash)}` +
    `&type=${encodeURIComponent(email_data.email_action_type)}` +
    `&redirect_to=${encodeURIComponent(email_data.redirect_to)}`

  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: user.email }],
      subject: copy.subject,
      htmlContent: buildHtml(copy, link),
    }),
  })

  if (!res.ok) {
    console.error(`[Brevo] auth email failed: ${res.status} ${await res.text()}`)
    return fail(502, "Couldn't send the email. Try again in a moment.")
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
