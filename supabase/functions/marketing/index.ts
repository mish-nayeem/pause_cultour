// Edge Function: marketing
//
// Paste into the Supabase Dashboard editor (Edge Functions → Deploy a new
// function → Via Editor), name it "marketing", Deploy. Needs
// supabase-migration-marketing-auto.sql run first.
//
// Admin only (or the daily cron, with x-cron-secret). Actions:
//   { action: 'check' }                      → which integrations have keys, and whether they answer
//   { action: 'meta_sync', days }            → Meta ad spend per day + Instagram / Facebook followers
//   { action: 'email_test', subject, html, to }      → a test of a campaign to one address
//   { action: 'email_send', subject, html, emails, audience } → a Brevo campaign to those emails
//   { action: 'email_stats' }                → pulls opens / clicks for the campaigns sent from here
//
// ─────────────────────────────────────────────────────────────────────────
// Secrets (Edge Functions → Secrets) — only for what you switch on:
//
//   Brevo (email campaigns) — BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME
//     (the order emails already use these three)
//
//   Meta (ad spend, followers) —
//     META_ACCESS_TOKEN    a long-lived system-user token
//     META_AD_ACCOUNT_ID   the ad account's number (with or without act_)
//     META_IG_USER_ID      the Instagram business account id (optional)
//     META_PAGE_ID         the Facebook page id (optional)
//     META_API_VERSION     optional, default v21.0
//
//   MARKETING_CRON_SECRET  any long random text — only for the daily sync
//   ADMIN_EMAIL            already set
// ─────────────────────────────────────────────────────────────────────────

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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function env(name: string): string | undefined {
  const v = Deno.env.get(name)
  return v && v.trim() ? v.trim() : undefined
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Errors the admin panel reads: NOT_CONFIGURED:<what>, SAID:<what the service said>.
function notConfigured(what: string): never {
  throw new Error(`NOT_CONFIGURED:${what}`)
}

async function said(res: Response, who: string): Promise<never> {
  const text = await res.text()
  let msg = text.slice(0, 300)
  try {
    const j = JSON.parse(text)
    msg = j?.error?.message || j?.message || msg
  } catch { /* plain text */ }
  throw new Error(`SAID:${who}: ${msg}`)
}

// ---------------------------------------------------------------- Meta ----

function meta() {
  const token = env('META_ACCESS_TOKEN')
  if (!token) notConfigured('meta')
  const v = env('META_API_VERSION') || 'v21.0'
  const account = env('META_AD_ACCOUNT_ID')
  return {
    token,
    base: `https://graph.facebook.com/${v}`,
    account: account ? (account.startsWith('act_') ? account : `act_${account}`) : undefined,
    ig: env('META_IG_USER_ID'),
    page: env('META_PAGE_ID'),
  }
}

async function graph(path: string, params: Record<string, string>) {
  const m = meta()
  const url = new URL(`${m.base}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('access_token', m.token!)
  const res = await fetch(url)
  if (!res.ok) await said(res, 'Meta')
  return res.json()
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}

async function metaSync(db: ReturnType<typeof createClient>, days: number) {
  const m = meta()
  const out: Record<string, unknown> = {}

  // Ad spend, by day, campaign and where it ran (Facebook / Instagram).
  if (m.account) {
    const until = new Date()
    const since = new Date(Date.now() - Math.max(1, Math.min(days, 90)) * 86400e3)
    const rows: Record<string, unknown>[] = []
    let next: string | null = null
    let page = await graph(`${m.account}/insights`, {
      level: 'campaign',
      fields: 'campaign_name,spend,impressions,clicks',
      breakdowns: 'publisher_platform',
      time_increment: '1',
      time_range: JSON.stringify({ since: ymd(since), until: ymd(until) }),
      limit: '500',
    })
    for (;;) {
      for (const r of page?.data ?? []) {
        const p = String(r.publisher_platform || 'other').toLowerCase()
        rows.push({
          day: r.date_start,
          platform: p === 'facebook' || p === 'instagram' ? p : 'other',
          campaign_name: r.campaign_name || '',
          spend: Number(r.spend) || 0,
          impressions: Number(r.impressions) || 0,
          clicks: Number(r.clicks) || 0,
          synced_at: new Date().toISOString(),
        })
      }
      next = page?.paging?.next ?? null
      if (!next) break
      const res = await fetch(next)
      if (!res.ok) await said(res, 'Meta')
      page = await res.json()
    }
    // Same day + platform + campaign twice (other placements) → add up.
    const merged = new Map<string, Record<string, number | string>>()
    for (const r of rows) {
      const k = `${r.day}|${r.platform}|${r.campaign_name}`
      const e = merged.get(k)
      if (e) {
        e.spend = Number(e.spend) + Number(r.spend)
        e.impressions = Number(e.impressions) + Number(r.impressions)
        e.clicks = Number(e.clicks) + Number(r.clicks)
      } else merged.set(k, { ...(r as Record<string, number | string>) })
    }
    if (merged.size) {
      const { error } = await db.from('meta_ad_daily').upsert([...merged.values()], { onConflict: 'day,platform,campaign_name' })
      if (error) throw new Error(`DB:${error.message}`)
    }
    out.ads = { days, rows: merged.size }
  } else out.ads = 'skipped — META_AD_ACCOUNT_ID not set'

  // Followers, once a day.
  const today = ymd(new Date())
  const snaps: Record<string, unknown>[] = []
  if (m.ig) {
    const ig = await graph(m.ig, { fields: 'followers_count,media_count,username' })
    snaps.push({ platform: 'Instagram', followers: Number(ig.followers_count) || 0, media_count: Number(ig.media_count) || null, engagement_rate: 0, source: 'meta', captured_on: today })
  }
  if (m.page) {
    const pg = await graph(m.page, { fields: 'followers_count,fan_count,name' })
    snaps.push({ platform: 'Facebook', followers: Number(pg.followers_count ?? pg.fan_count) || 0, engagement_rate: 0, source: 'meta', captured_on: today })
  }
  for (const s of snaps) {
    await db.from('social_stats').delete().eq('source', 'meta').eq('platform', s.platform).eq('captured_on', today)
    const { error } = await db.from('social_stats').insert(s)
    if (error) throw new Error(`DB:${error.message}`)
  }
  out.followers = snaps.map((s) => `${s.platform} ${s.followers}`)
  return out
}

// --------------------------------------------------------------- Brevo ----

function brevo() {
  const key = env('BREVO_API_KEY')
  const from = env('BREVO_FROM_EMAIL')
  if (!key || !from) notConfigured('brevo')
  return { key: key!, sender: { email: from!, name: env('BREVO_FROM_NAME') || 'PAUSE' } }
}

async function bv(path: string, init: RequestInit = {}) {
  const b = brevo()
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    ...init,
    headers: { 'api-key': b.key, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) await said(res, 'Brevo')
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

// Brevo needs an unsubscribe link in every campaign; one goes at the foot.
function withFooter(html: string) {
  if (html.includes('{{ unsubscribe }}') || html.includes('{{unsubscribe}}')) return html
  return `${html}
<p style="font-family:Arial,sans-serif;font-size:11px;color:#8b8a82;margin-top:28px;text-align:center">
You're getting this because you shopped with or signed up to PAUSE. <a href="{{ unsubscribe }}" style="color:#8b8a82">Unsubscribe</a>
</p>`
}

const cleanEmails = (list: unknown) =>
  [...new Set((Array.isArray(list) ? list : []).map((e) => String(e || '').trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))]

async function emailSend(db: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const b = brevo()
  const subject = String(body.subject || '').trim()
  const html = String(body.html || '').trim()
  const emails = cleanEmails(body.emails)
  if (!subject || !html) throw new Error('SAID:Write a subject and a message.')
  if (!emails.length) throw new Error('SAID:No one to send to — pick an audience with email addresses.')
  if (emails.length > 5000) throw new Error('SAID:More than 5,000 people — split the audience.')

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  // A folder and a list of their own, so Brevo keeps who got which campaign.
  const folders = await bv('/contacts/folders?limit=50&offset=0')
  let folderId = (folders.folders || []).find((f: { name: string }) => f.name === 'PAUSE admin')?.id
  if (!folderId) folderId = (await bv('/contacts/folders', { method: 'POST', body: JSON.stringify({ name: 'PAUSE admin' }) })).id
  const list = await bv('/contacts/lists', { method: 'POST', body: JSON.stringify({ name: `${subject.slice(0, 60)} · ${stamp}`, folderId }) })

  // Brevo keeps anyone who unsubscribed blacklisted, so they're skipped by
  // Brevo itself, whatever list they're put on.
  let added = 0
  if (emails.length <= 100) {
    // A short list: one by one — each is on the list the moment it returns.
    for (const email of emails) {
      try {
        await bv('/contacts', { method: 'POST', body: JSON.stringify({ email, listIds: [list.id], updateEnabled: true }) })
        added++
      } catch (e) {
        console.warn('[marketing] contact skipped', email, String((e as Error).message).slice(0, 120))
      }
    }
  } else {
    // A long one: Brevo's import, then wait for it to finish, so the
    // campaign never goes to a half-filled list.
    const imp = await bv('/contacts/import', {
      method: 'POST',
      body: JSON.stringify({ listIds: [list.id], updateExistingContacts: true, emptyContactsAttributes: false, jsonBody: emails.map((email) => ({ email })) }),
    })
    let done = false
    for (let i = 0; i < 40 && !done; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const p = await bv(`/processes/${imp.processId}`)
      done = p.status === 'completed'
    }
    if (!done) throw new Error('SAID:Brevo is still importing the list — try sending again in a minute.')
    added = emails.length
  }

  const campaign = await bv('/emailCampaigns', {
    method: 'POST',
    body: JSON.stringify({
      name: `${subject.slice(0, 80)} · ${stamp}`,
      subject,
      sender: b.sender,
      type: 'classic',
      htmlContent: withFooter(html),
      recipients: { listIds: [list.id] },
    }),
  })
  await bv(`/emailCampaigns/${campaign.id}/sendNow`, { method: 'POST' })

  const row = {
    campaign: subject,
    subject,
    audience: String(body.audience || ''),
    recipients: added,
    status: 'sent',
    sent_at: new Date().toISOString(),
    brevo_id: campaign.id,
    open_rate: 0,
    click_rate: 0,
  }
  const { data, error } = await db.from('email_campaigns').insert(row).select().single()
  if (error) throw new Error(`DB:${error.message}`)
  return { campaign: data, sentTo: added }
}

async function emailTest(body: Record<string, unknown>) {
  const b = brevo()
  const to = cleanEmails([body.to])[0]
  if (!to) throw new Error('SAID:Enter the address to send the test to.')
  await bv('/smtp/email', {
    method: 'POST',
    body: JSON.stringify({
      sender: b.sender,
      to: [{ email: to }],
      subject: `[TEST] ${String(body.subject || '').trim()}`,
      htmlContent: withFooter(String(body.html || '')).replaceAll('{{ unsubscribe }}', '#'),
    }),
  })
  return { sentTo: to }
}

async function emailStats(db: ReturnType<typeof createClient>) {
  const { data: rows, error } = await db.from('email_campaigns').select('id, brevo_id, recipients').not('brevo_id', 'is', null).order('sent_at', { ascending: false }).limit(30)
  if (error) throw new Error(`DB:${error.message}`)
  let updated = 0
  for (const r of rows || []) {
    const c = await bv(`/emailCampaigns/${r.brevo_id}?statistics=globalStats`)
    const g = c?.statistics?.globalStats || {}
    const delivered = Number(g.delivered) || 0
    const opens = Number(g.uniqueViews ?? g.viewed) || 0
    const clicks = Number(g.uniqueClicks ?? g.clickers) || 0
    const base = delivered || Number(r.recipients) || 0
    await db.from('email_campaigns').update({
      delivered,
      opens,
      clicks,
      unsubscribes: Number(g.unsubscriptions) || 0,
      open_rate: base ? Math.round((opens / base) * 1000) / 10 : 0,
      click_rate: base ? Math.round((clicks / base) * 1000) / 10 : 0,
      stats_at: new Date().toISOString(),
    }).eq('id', r.id)
    updated++
  }
  return { updated }
}

// --------------------------------------------------------------- check ----

async function check() {
  const out: Record<string, { ok: boolean; message: string }> = {}
  try {
    const b = brevo()
    const acc = await bv('/account')
    out.brevo = { ok: true, message: `Connected · ${acc.email || b.sender.email} · sending as ${b.sender.email}` }
  } catch (e) {
    out.brevo = { ok: false, message: String((e as Error).message) }
  }
  try {
    const m = meta()
    const me = await graph('me', { fields: 'id,name' })
    const parts = [`token for ${me.name || me.id}`]
    if (m.account) {
      const a = await graph(m.account, { fields: 'name,currency' })
      parts.push(`ad account "${a.name}" (${a.currency})`)
    } else parts.push('no ad account id')
    if (m.ig) parts.push('Instagram ✓')
    if (m.page) parts.push('Facebook page ✓')
    out.meta = { ok: true, message: `Connected · ${parts.join(' · ')}` }
  } catch (e) {
    out.meta = { ok: false, message: String((e as Error).message) }
  }
  return out
}

// ----------------------------------------------------------------- main ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // The daily cron may only sync; everything else is the admin's.
    const cron = env('MARKETING_CRON_SECRET')
    const isCron = Boolean(cron) && req.headers.get('x-cron-secret') === cron
    if (!isCron || action !== 'meta_sync') {
      if (!(await callerIsAdmin(req))) return json({ error: 'Not allowed' }, 403)
    }

    if (action === 'check') return json({ services: await check() })
    if (action === 'meta_sync') return json(await metaSync(db, Number(body.days) || 30))
    if (action === 'email_test') return json(await emailTest(body))
    if (action === 'email_send') return json(await emailSend(db, body))
    if (action === 'email_stats') return json(await emailStats(db))
    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    const message = String((err as Error).message ?? err)
    console.error('[marketing]', message)
    return json({ error: message }, 400)
  }
})
