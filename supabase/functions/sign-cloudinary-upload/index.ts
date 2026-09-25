// Edge Function: sign-cloudinary-upload
//
// Paste this whole file into the Supabase Dashboard editor
// (Edge Functions → Deploy a new function → Via Editor), name the
// function "sign-cloudinary-upload", then click Deploy function.
//
// Returns a short-lived signature so the admin's browser can upload straight
// to Cloudinary without the API secret ever leaving the server.
//
// The alternative — an unsigned upload preset — would let anyone who found the
// preset name upload into the account and burn through the 25-credit free tier.
// Requiring the admin JWT here means only a signed-in admin can get a
// signature, and each signature covers one upload into one folder.
//
// Secrets needed (Edge Functions → Secrets):
//   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_EMAIL
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

// Cloudinary signs the alphabetically sorted params joined as a query string,
// with the API secret appended, hashed with SHA-1.
async function sign(params: Record<string, string>, apiSecret: string): Promise<string> {
  const toSign =
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&') + apiSecret

  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign))

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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

    const apiKey = Deno.env.get('CLOUDINARY_API_KEY')
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET')

    if (!apiKey || !apiSecret) {
      console.error('[Cloudinary] CLOUDINARY_API_KEY or CLOUDINARY_API_SECRET is not set')
      return new Response(JSON.stringify({ error: 'Upload not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Folder is fixed server-side rather than taken from the request, so a
    // signature can't be reused to write anywhere else in the account.
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const params = { folder: 'pause', timestamp }
    const signature = await sign(params, apiSecret)

    return new Response(
      JSON.stringify({ signature, timestamp, apiKey, folder: params.folder }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[sign-cloudinary-upload]', err.message)
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
