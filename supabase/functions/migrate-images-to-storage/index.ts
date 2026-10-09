// Edge Function: migrate-images-to-storage
//
// Paste this whole file into the Supabase Dashboard editor
// (Edge Functions → Deploy a new function → Via Editor), name it
// "migrate-images-to-storage", then click Deploy function.
//
// Copies every photo still on Cloudinary into the Supabase `images` bucket
// and points the database at the new copy — products.images,
// hero_slides.image_url and about_blocks.image_url. Run from the admin
// panel's "Move images to Supabase" button.
//
//   { dryRun: true }       → only counts what's left
//   { skip: [urls...] }    → moves the next batch, leaving out photos that
//                            already failed this run, returns what's left
//
// A batch at a time so one call never runs long; the admin panel keeps
// calling until nothing is left. Safe to run again at any point: a photo
// lands at a path built from its Cloudinary path, so a re-run overwrites the
// same file instead of making a second copy, and a row is only rewritten
// once its new photo is actually in the bucket.
//
// Admin only, same check as send-status-update.
//
// Secrets needed: ADMIN_EMAIL (already set). SUPABASE_URL, SUPABASE_ANON_KEY
// and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

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

const BUCKET = 'images'
const BATCH = 10
const CLOUDINARY_MARKER = '/image/upload/'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isCloudinary(url: unknown): url is string {
  return typeof url === 'string' && url.includes('res.cloudinary.com') && url.includes(CLOUDINARY_MARKER)
}

// https://res.cloudinary.com/<cloud>/image/upload/[transforms/][v123/]pause/abc.jpg
//   → migrated/pause/abc.jpg
// Built from the URL alone, so the same photo always maps to the same path.
function targetPath(url: string): string {
  let rest = url.split(CLOUDINARY_MARKER)[1].split('?')[0]
  rest = rest.replace(/^([a-z]{1,3}_[^/]+\/)+/, '') // transformation segments
  rest = rest.replace(/^v\d+\//, '') // version
  const safe = rest.replace(/[^A-Za-z0-9/._-]/g, '_')
  return `migrated/${safe}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ---- Verify the caller is the admin ----
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: userData } = await authClient.auth.getUser()
    const callerEmail = userData?.user?.email?.trim().toLowerCase()
    const adminEmail = Deno.env.get('ADMIN_EMAIL')?.trim().toLowerCase()

    if (!callerEmail || !adminEmail || callerEmail !== adminEmail) {
      return json({ error: 'Forbidden' }, 403)
    }

    const { dryRun, skip } = await req.json().catch(() => ({}))
    const skipped = new Set<string>(Array.isArray(skip) ? skip : [])

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ---- Everything that still points at Cloudinary ----
    const [productsRes, heroRes, aboutRes] = await Promise.all([
      supabase.from('products').select('id, images'),
      supabase.from('hero_slides').select('id, image_url'),
      supabase.from('about_blocks').select('id, image_url'),
    ])

    for (const r of [productsRes, heroRes, aboutRes]) {
      if (r.error) throw r.error
    }

    const products = (productsRes.data ?? []) as { id: string; images: string[] | null }[]
    const heroes = (heroRes.data ?? []) as { id: string; image_url: string | null }[]
    const abouts = (aboutRes.data ?? []) as { id: string; image_url: string | null }[]

    // One photo can sit on several rows (a colour shared between products,
    // say) — each is copied once.
    const pending = new Set<string>()
    for (const p of products) for (const u of p.images ?? []) if (isCloudinary(u)) pending.add(u)
    for (const h of heroes) if (isCloudinary(h.image_url)) pending.add(h.image_url)
    for (const a of abouts) if (isCloudinary(a.image_url)) pending.add(a.image_url)

    if (dryRun) return json({ remaining: pending.size })

    // ---- Copy this batch ----
    const moved = new Map<string, string>()
    const failed: { url: string; reason: string }[] = []

    const batch = [...pending].filter((u) => !skipped.has(u)).slice(0, BATCH)

    for (const url of batch) {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`download ${res.status}`)

        const contentType = res.headers.get('content-type') || 'image/jpeg'
        const body = new Uint8Array(await res.arrayBuffer())
        const path = targetPath(url)

        const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
          contentType,
          cacheControl: '31536000',
          upsert: true,
        })
        if (error) throw error

        moved.set(url, supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
      } catch (err) {
        failed.push({ url, reason: (err as Error).message })
      }
    }

    // ---- Point the rows at the new copies ----
    const swap = (u: string | null) => (u && moved.has(u) ? moved.get(u)! : u)

    for (const p of products) {
      const images = p.images ?? []
      if (!images.some((u) => moved.has(u))) continue
      const { error } = await supabase.from('products').update({ images: images.map(swap) }).eq('id', p.id)
      if (error) throw error
    }

    for (const h of heroes) {
      if (!h.image_url || !moved.has(h.image_url)) continue
      const { error } = await supabase.from('hero_slides').update({ image_url: swap(h.image_url) }).eq('id', h.id)
      if (error) throw error
    }

    for (const a of abouts) {
      if (!a.image_url || !moved.has(a.image_url)) continue
      const { error } = await supabase.from('about_blocks').update({ image_url: swap(a.image_url) }).eq('id', a.id)
      if (error) throw error
    }

    return json({
      moved: moved.size,
      failed,
      // Still on Cloudinary, failures included — they stay where they were.
      remaining: pending.size - moved.size,
      // Left to try this run: the panel stops once this reaches 0.
      left: [...pending].filter((u) => !skipped.has(u) && !moved.has(u) && !failed.some((f) => f.url === u)).length,
    })
  } catch (err) {
    console.error('[migrate-images-to-storage]', (err as Error).message)
    Sentry.captureException(err)
    // The isolate can be torn down the instant this function returns —
    // without waiting for the event to actually reach Sentry, it may never
    // arrive at all.
    await Sentry.flush(2000)
    return json({ error: 'Unexpected error' }, 500)
  }
})
