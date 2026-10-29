// Edge Function: notify
//
// Paste into the Supabase Dashboard editor (Edge Functions → Deploy a new
// function → Via Editor), name it "notify", Deploy, then open it →
// Settings → turn "Verify JWT" OFF (the database calls it on every new
// order without a login; the admin-only actions check the admin themselves).
// Needs supabase-migration-push-notifications.sql run first.
//
// Phone notifications for the admin (the installed PAUSE Admin app):
//   { action: 'key' }                       → the public key a phone subscribes with
//   { action: 'subscribe', subscription }   → this phone gets notifications
//   { action: 'unsubscribe', endpoint }     → this phone stops
//   { action: 'test' }                      → a test notification to every phone
//   { action: 'order', order_id }           → "New order" — sent by the database
//                                              trigger the moment an order comes in
//
// No secrets to add: the notification keys (VAPID) are made by this function
// the first time and kept in the push_config table, which only it can read.
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

// ---- webpush start ----
// Web Push by hand with the runtime's own WebCrypto, so no library is needed:
// the message is encrypted for the phone (RFC 8291, aes128gcm) and signed with
// our VAPID key (RFC 8292). Works with Google's (Android / Chrome) and Apple's
// (iPhone) push services alike.

const enc = new TextEncoder()

function b64u(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64u(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

// A new VAPID key pair: the public half as the browser wants it (base64url
// of the 65-byte point), the private half as a JWK.
export async function makeVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicKey: b64u(pub), privateJwk: jwk }
}

async function vapidHeader(endpoint: string, publicKey: string, privateJwk: JsonWebKey, subject: string) {
  const aud = new URL(endpoint).origin
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })))
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`
}

// The payload encrypted for one phone (its p256dh key and auth secret).
export async function encryptPayload(payload: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh)
  const authSecret = unb64u(auth)
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))))

  const rs = new Uint8Array([0, 0, 0x10, 0]) // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  message: Record<string, unknown>,
  vapid: { publicKey: string; privateJwk: JsonWebKey; subject: string },
): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateJwk, vapid.subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  })
  if (!res.ok) console.warn('[notify] push refused', res.status, (await res.text()).slice(0, 200))
  return res.status
}
// ---- webpush end ----

type Db = ReturnType<typeof createClient>

// The VAPID keys, made on first use.
async function vapidKeys(db: Db) {
  const { data, error } = await db.from('push_config').select('public_key, private_jwk').eq('id', 1).maybeSingle()
  if (error) throw new Error(`DB:${error.message}`)
  if (data?.public_key) return { publicKey: data.public_key as string, privateJwk: data.private_jwk as JsonWebKey }
  const made = await makeVapidKeys()
  const { error: e2 } = await db.from('push_config').upsert({ id: 1, public_key: made.publicKey, private_jwk: made.privateJwk })
  if (e2) throw new Error(`DB:${e2.message}`)
  return made
}

// Every subscribed phone; ones the push service says are gone are removed.
async function pushAll(db: Db, message: Record<string, unknown>) {
  const keys = await vapidKeys(db)
  const subject = `mailto:${Deno.env.get('ADMIN_EMAIL') || 'admin@example.com'}`
  const { data: subs, error } = await db.from('push_subscriptions').select('endpoint, p256dh, auth')
  if (error) throw new Error(`DB:${error.message}`)
  let sent = 0
  for (const s of subs || []) {
    try {
      const status = await sendPush(s, message, { ...keys, subject })
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      else if (status < 300) {
        sent++
        await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('endpoint', s.endpoint)
      }
    } catch (e) {
      console.warn('[notify] push failed', String((e as Error).message).slice(0, 200))
    }
  }
  return { sent, phones: (subs || []).length }
}

const taka = (n: unknown) => '৳' + Math.round(Number(n || 0)).toLocaleString('en-US')

// A small square of a product's first photo for the notification (Android
// shows it beside the text; iPhone always shows the app's own icon).
async function productThumb(db: Db, productId: string): Promise<string | null> {
  const { data } = await db.from('products').select('images').eq('id', productId).maybeSingle()
  const url = Array.isArray(data?.images) ? String(data.images[0] || '') : ''
  if (!url) return null
  const object = '/storage/v1/object/public/'
  if (url.includes(object) && !url.includes('?')) {
    return url.replace(object, '/storage/v1/render/image/public/') + '?width=192&height=192&resize=cover&quality=70&format=origin'
  }
  return url
}

async function newOrder(db: Db, orderId: string) {
  if (!orderId || orderId.startsWith('PM')) return { skipped: 'manual order' } // made in the admin itself
  const { data: o } = await db
    .from('orders')
    .select('id, customer_name, customer_area, subtotal, total, created_at, order_items(id, product_id, product_name, size, qty)')
    .eq('id', orderId)
    .maybeSingle()
  // Only a real order, and only while it's new — calling this again later
  // (or with a made-up id) sends nothing.
  if (!o || Date.now() - new Date(o.created_at).getTime() > 15 * 60 * 1000) return { skipped: 'not a new order' }
  const { error } = await db.from('push_sent').insert({ order_id: o.id })
  if (error) return { skipped: 'already sent' }

  // In the order they were put in the cart — the first is what the
  // notification shows a photo of.
  type Item = { id: number; product_id: string; product_name: string; size: string; qty: number }
  const lines = ((o.order_items || []) as Item[]).slice().sort((a, b) => a.id - b.id)
  const items = lines.map((it) => `${it.product_name} ${it.size} ×${it.qty}`).join(', ')
  const icon = lines[0] ? await productThumb(db, lines[0].product_id) : null
  return pushAll(db, {
    icon,
    title: `🛍 New order · ${taka(o.total ?? o.subtotal)}`,
    body: [o.customer_name, items, o.customer_area].filter(Boolean).join(' · ').slice(0, 180),
    url: `/admin?order=${encodeURIComponent(o.id)}`,
    tag: `order-${o.id}`,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    if (action === 'order') return json(await newOrder(db, String(body.order_id || '')))

    // Everything else is the admin's.
    if (!(await callerIsAdmin(req))) return json({ error: 'Not allowed' }, 403)

    if (action === 'key') return json({ publicKey: (await vapidKeys(db)).publicKey })

    if (action === 'subscribe') {
      const s = body.subscription || {}
      if (!s.endpoint || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'Bad subscription' }, 400)
      const { error } = await db.from('push_subscriptions').upsert({
        endpoint: s.endpoint,
        p256dh: s.keys.p256dh,
        auth: s.keys.auth,
        label: String(body.label || '').slice(0, 80),
      })
      if (error) throw new Error(`DB:${error.message}`)
      return json({ ok: true })
    }

    if (action === 'unsubscribe') {
      await db.from('push_subscriptions').delete().eq('endpoint', String(body.endpoint || ''))
      return json({ ok: true })
    }

    if (action === 'test') {
      return json(await pushAll(db, { title: '🔔 PAUSE Admin', body: 'Notifications are on. New orders will show up here.', url: '/admin', tag: 'test' }))
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    const message = String((err as Error).message ?? err)
    console.error('[notify]', message)
    return json({ error: message }, 400)
  }
})
