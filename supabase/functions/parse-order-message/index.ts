// Edge Function: parse-order-message
//
// Paste this whole file into the Supabase Dashboard editor
// (Edge Functions → parse-order-message → Edit), then click Deploy.
//
// Takes a screenshot (base64) or pasted text of a chat where a customer
// already agreed to an order over DM, and asks Gemini to pull out their
// details and what they're buying — matched against the real product
// catalog so the guess is an actual product name, not an invented one.
//
// This never writes anything. It only returns a best guess for the admin
// panel's "New order" form to pre-fill; a person checks and corrects it
// before it goes anywhere near place_order.
//
// Secrets needed (Edge Functions → Secrets): GEMINI_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Flash is Google's free-tier, multimodal model. Google retires specific
// model names fairly often, so this tries a list in order and moves on when
// one 404s (retired) or 503s (overloaded). The current model goes first; the
// rest are fallbacks, and 2.0 is left out because Google has shut it down.
// Set a GEMINI_MODEL secret to put your own choice first without redeploying.
const GEMINI_MODELS = [
  Deno.env.get('GEMINI_MODEL'),
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
].filter((m): m is string => !!m)

const DISTRICTS = [
  'Dhaka', 'Bagerhat', 'Bandarban', 'Barguna', 'Barishal', 'Bhola', 'Bogura', 'Brahmanbaria',
  'Chandpur', 'Chapai Nawabganj', 'Chattogram', 'Chuadanga', 'Cumilla', "Cox's Bazar",
  'Dinajpur', 'Faridpur', 'Feni', 'Gaibandha', 'Gazipur', 'Gopalganj', 'Habiganj', 'Jamalpur',
  'Jashore', 'Jhalokati', 'Jhenaidah', 'Joypurhat', 'Khagrachhari', 'Khulna', 'Kishoreganj',
  'Kurigram', 'Kushtia', 'Lakshmipur', 'Lalmonirhat', 'Madaripur', 'Magura', 'Manikganj',
  'Meherpur', 'Moulvibazar', 'Munshiganj', 'Mymensingh', 'Naogaon', 'Narail', 'Narayanganj',
  'Narsingdi', 'Natore', 'Netrokona', 'Nilphamari', 'Noakhali', 'Pabna', 'Panchagarh',
  'Patuakhali', 'Pirojpur', 'Rajbari', 'Rajshahi', 'Rangamati', 'Rangpur', 'Satkhira',
  'Shariatpur', 'Sherpur', 'Sirajganj', 'Sunamganj', 'Sylhet', 'Tangail', 'Thakurgaon',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { text, image, mimeType } = await req.json()

    if (!text && !image) {
      return new Response(JSON.stringify({ error: 'Provide text or an image' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not set' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Real product names, so Gemini matches against the actual catalog
    // instead of inventing one that doesn't exist.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    )
    const { data: products } = await supabase.from('products').select('name, variant')
    const catalog = (products || []).map((p) => `${p.name} — ${p.variant}`).join('\n')

    const prompt = `You are reading a customer's chat message (a screenshot or pasted text, often Bengali/English mixed and casual) sent to a Bangladeshi streetwear shop called PAUSE, to pull out an order the customer already agreed to place. Return ONLY JSON in exactly this shape, no markdown fences, no commentary:

{
  "customer_name": string or null,
  "customer_phone": string or null,
  "customer_email": string or null,
  "customer_address": string or null,
  "district": string or null,
  "items": [ { "product_match": string or null, "size": string or null, "qty": number } ]
}

Rules:
- "district" must be exactly one of this list, or null if you can't tell: ${DISTRICTS.join(', ')}
- "product_match" must be an exact line from this catalog if you're confident of the match, or null if not:
${catalog}
- "size" is a plain letter like S, M, L or XL if mentioned, else null.
- "qty" defaults to 1 if not stated.
- Only include items that read as an actual order, not general chatter.
- If a field truly can't be determined, use null rather than guessing.
${text ? `\nMessage text:\n${text}` : ''}`

    // Gemini's REST API wants camelCase here (inlineData/mimeType) even
    // though Google's own docs and client libraries often show the proto's
    // snake_case names — sending snake_case gets the image part silently
    // ignored or the request rejected outright.
    const parts: Record<string, unknown>[] = [{ text: prompt }]
    if (image) {
      parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: image } })
    }

    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: 'application/json' },
    })

    let res: Response | null = null
    let lastDetail = ''
    outer: for (const model of GEMINI_MODELS) {
      // Overload spikes are usually over in a second or two, so a 503 gets one
      // short retry on the same model before moving to the next one.
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
        )
        if (res.ok) break outer

        lastDetail = `${model}: ${res.status} ${await res.text()}`
        console.error('[Gemini] request failed:', lastDetail)
        if (res.status !== 503) break
        await new Promise((r) => setTimeout(r, 1500))
      }
      // A bad key or a quota hit would fail identically on every model, so
      // only a missing (404) or overloaded (503) one moves on to the next.
      if (res.status !== 404 && res.status !== 503) break
    }

    if (!res || !res.ok) {
      // Gemini's own message (bad key, quota, unknown model…) goes back to the
      // admin form, since that's the only place anyone will see it.
      let reason = lastDetail
      try {
        reason = JSON.parse(lastDetail.slice(lastDetail.indexOf('{'))).error?.message || lastDetail
      } catch {
        // Not JSON — the raw text is still more useful than nothing.
      }
      return new Response(JSON.stringify({ error: `Gemini: ${reason}`.slice(0, 300) }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!raw) {
      console.error('[Gemini] empty response:', JSON.stringify(data))
      return new Response(JSON.stringify({ error: 'Gemini returned nothing usable' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let extracted
    try {
      extracted = JSON.parse(raw)
    } catch {
      console.error('[Gemini] unparsable response:', raw)
      return new Response(JSON.stringify({ error: 'Could not parse the extracted details' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[parse-order-message]', err.message)
    return new Response(JSON.stringify({ error: 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
