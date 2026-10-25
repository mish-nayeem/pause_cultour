import { useEffect, useMemo, useState } from 'react'
import AdminBox from './AdminBox.jsx'
import { ServiceBox } from './MarketingSetup.jsx'
import { callMarketing, fetchEmailCampaigns, fetchSubscribers } from '../lib/marketing.js'
import { campaignSlug } from './LinkGenerator.jsx'
import { orderMoney, unsold } from '../lib/admin.js'
import './marketing-auto.css'

function taka(n) {
  const v = Math.round(Number(n || 0))
  return (v < 0 ? '− ' : '') + '৳ ' + Math.abs(v).toLocaleString()
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// The button's link with the campaign stamped on, so its orders show here
// and in Overview → Order sources as "Email campaign".
function trackedLink(link, slug) {
  try {
    const url = new URL(link || '/', window.location.origin)
    if (url.origin === window.location.origin) {
      url.searchParams.set('utm_source', 'email')
      url.searchParams.set('utm_medium', 'email')
      if (slug) url.searchParams.set('utm_campaign', slug)
    }
    return url.toString()
  } catch {
    return link
  }
}

export function emailHtml({ heading, message, image, button, link }) {
  const paras = String(message || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#222">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
  return `<div style="max-width:560px;margin:0 auto;padding:28px 22px;font-family:Helvetica,Arial,sans-serif;background:#fff">
<div style="font-size:13px;letter-spacing:0.3em;font-weight:700;color:#111;margin-bottom:22px">PAUSE</div>
${image ? `<img src="${esc(image)}" alt="" style="width:100%;border-radius:8px;margin-bottom:20px;display:block">` : ''}
${heading ? `<h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#111">${esc(heading)}</h1>` : ''}
${paras}
${button && link ? `<a href="${esc(link)}" style="display:inline-block;margin-top:8px;background:#111;color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-size:14px;font-weight:600">${esc(button)}</a>` : ''}
</div>`
}

const AUDIENCES = [
  { key: 'subs', label: 'Newsletter subscribers' },
  { key: 'buyers', label: 'Customers who ordered' },
  { key: 'both', label: 'Both (each once)' },
]

const EMPTY = { subject: '', heading: '', message: '', image: '', button: 'Shop now', link: '/shop', campaign: '' }

// Marketing → Email. Write a campaign, send it through Brevo to subscribers
// and/or customers; opens and clicks come back from Brevo, orders from the
// button's link. Typed rows from before stay listed at the bottom.
export default function EmailCampaigns({ orders, adminEmail, onDeleteLegacy }) {
  const [draft, setDraft] = useState(EMPTY)
  const [audience, setAudience] = useState('both')
  const [subs, setSubs] = useState([])
  const [rows, setRows] = useState([])
  const [testTo, setTestTo] = useState(adminEmail || '')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => { fetchSubscribers().then(({ rows }) => setSubs(rows)) }, [])
  useEffect(() => { fetchEmailCampaigns().then(({ rows }) => setRows(rows)) }, [tick])

  const lists = useMemo(() => {
    const s = new Set(subs.map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean))
    const b = new Set(orders.map((o) => String(o.customer_email || '').trim().toLowerCase()).filter(Boolean))
    return { subs: [...s], buyers: [...b], both: [...new Set([...s, ...b])] }
  }, [subs, orders])

  const slug = campaignSlug(draft.campaign || draft.subject)
  const html = emailHtml({ ...draft, link: trackedLink(draft.link, slug) })
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value })
  const ready = draft.subject.trim() && (draft.heading.trim() || draft.message.trim())

  async function run(kind, body, done) {
    setBusy(kind)
    setErr('')
    setNote('')
    const { data, error } = await callMarketing(body)
    setBusy('')
    if (error) return setErr(error)
    done(data)
  }

  function sendTest() {
    run('test', { action: 'email_test', subject: draft.subject, html, to: testTo }, (d) => setNote(`Test sent to ${d.sentTo}.`))
  }

  function send() {
    const emails = lists[audience]
    const name = AUDIENCES.find((a) => a.key === audience).label
    if (!window.confirm(`Send “${draft.subject}” to ${emails.length} people (${name})? This can't be undone.`)) return
    run('send', { action: 'email_send', subject: draft.subject, html, emails, audience: `${name} · ${slug}` }, (d) => {
      setNote(`Sent to ${d.sentTo} people. Opens and clicks come in over the next hours — press Refresh stats.`)
      setDraft(EMPTY)
      setTick((t) => t + 1)
    })
  }

  function refresh() {
    run('stats', { action: 'email_stats' }, (d) => {
      setNote(`Stats updated for ${d.updated} campaign${d.updated === 1 ? '' : 's'}.`)
      setTick((t) => t + 1)
    })
  }

  // Orders that came through each campaign's button.
  const byCampaign = useMemo(() => {
    const m = new Map()
    for (const o of orders) {
      if (String(o.utm_source || '').toLowerCase() !== 'email' || !o.utm_campaign) continue
      const k = String(o.utm_campaign).toLowerCase()
      const e = m.get(k) || { orders: 0, sales: 0, revenue: 0 }
      if (!unsold(o)) { e.orders++; e.sales += Number(o.total ?? o.subtotal ?? 0) }
      e.revenue += orderMoney(o).toShop
      m.set(k, e)
    }
    return m
  }, [orders])

  const sent = rows.filter((r) => r.brevo_id)
  const legacy = rows.filter((r) => !r.brevo_id)
  const slugOf = (r) => String(r.audience || '').split(' · ').pop()

  return (
    <div className="mk">
      <ServiceBox service="brevo" />
      {note && <div className="ab-note mono">{note}</div>}
      {err && <div className="ab-warn mono">{err}</div>}

      <AdminBox wide title="NEW CAMPAIGN" tip="Write it on the left, see it on the right. The button's link gets utm_source=email and the campaign name, so the orders it brings show up below and in Overview → Order sources. Every email has an Unsubscribe link at the bottom — Brevo adds it and keeps those people off future sends.">
        <div className="mk-compose">
          <div>
            <div className="ab-label mono">SUBJECT</div>
            <input className="ab-input" value={draft.subject} onChange={set('subject')} placeholder="Drop 03 is live" />
            <div className="ab-label mono">HEADING</div>
            <input className="ab-input" value={draft.heading} onChange={set('heading')} placeholder="New drop. Limited pieces." />
            <div className="ab-label mono">MESSAGE</div>
            <textarea className="ab-input" rows={6} value={draft.message} onChange={set('message')} placeholder="An empty line starts a new paragraph." />
            <div className="ab-label mono">IMAGE LINK (OPTIONAL)</div>
            <input className="ab-input" value={draft.image} onChange={set('image')} placeholder="https://…/drop03.jpg" />
            <div className="ab-row" style={{ marginTop: 12 }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div className="ab-label mono">BUTTON</div>
                <input className="ab-input" value={draft.button} onChange={set('button')} />
              </div>
              <div style={{ flex: 2, minWidth: 160 }}>
                <div className="ab-label mono">BUTTON GOES TO</div>
                <input className="ab-input" value={draft.link} onChange={set('link')} placeholder="/shop or /drops/…" />
              </div>
            </div>
            <div className="ab-label mono">CAMPAIGN NAME (FOR TRACKING)</div>
            <input className="ab-input" value={draft.campaign} onChange={set('campaign')} placeholder={draft.subject || 'drop03-launch'} />
            <div className="ab-note mono" style={{ marginTop: 6 }}>Tracked as: {slug || '—'}</div>

            <div className="ab-label mono">SEND TO</div>
            <div className="mk-aud">
              {AUDIENCES.map((a) => (
                <label key={a.key}>
                  <input type="radio" name="mk-aud" checked={audience === a.key} onChange={() => setAudience(a.key)} />
                  {a.label} <span className="dim mono">{lists[a.key].length}</span>
                </label>
              ))}
            </div>

            <div className="ab-label mono">TEST FIRST</div>
            <div className="ab-row">
              <input className="ab-input" style={{ flex: 1 }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@…" />
              <button type="button" className="ab-btn ghost" disabled={!ready || !!busy} onClick={sendTest}>{busy === 'test' ? 'Sending…' : 'Send test'}</button>
            </div>
            <div className="ab-row" style={{ marginTop: 14 }}>
              <button type="button" className="ab-btn" disabled={!ready || !!busy || !lists[audience].length} onClick={send}>
                {busy === 'send' ? 'Sending…' : `Send to ${lists[audience].length}`}
              </button>
            </div>
          </div>
          <div className="mk-preview"><iframe title="Email preview" srcDoc={html} /></div>
        </div>
      </AdminBox>

      <AdminBox
        wide
        title="SENT CAMPAIGNS"
        side={<button type="button" className="ab-btn ghost" disabled={!!busy || !sent.length} onClick={refresh}>{busy === 'stats' ? 'Refreshing…' : 'Refresh stats'}</button>}
        tip="Delivered, opens, clicks and unsubscribes come from Brevo when you press Refresh stats. Orders, sales and revenue come from the orders placed through the email's button."
      >
        {sent.length === 0 ? <div className="ab-empty mono">Nothing sent from here yet.</div> : (
          <div className="ovc-src-wrap">
            <table className="ovc-table ovc-src mono">
              <thead><tr><th>Campaign</th><th>Sent</th><th>To</th><th>Delivered</th><th>Open</th><th>Click</th><th>Unsub</th><th>Orders</th><th>Sales</th><th>Revenue</th></tr></thead>
              <tbody>{sent.map((r) => {
                const o = byCampaign.get(slugOf(r)) || { orders: 0, sales: 0, revenue: 0 }
                return (
                  <tr key={r.id}>
                    <td><span className="ovc-src-name">{r.subject || r.campaign}</span></td>
                    <td>{r.sent_at ? new Date(r.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</td>
                    <td>{r.recipients ?? '—'}</td>
                    <td>{r.stats_at ? r.delivered : '—'}</td>
                    <td>{r.stats_at ? `${r.open_rate}%` : '—'}</td>
                    <td>{r.stats_at ? `${r.click_rate}%` : '—'}</td>
                    <td>{r.stats_at ? r.unsubscribes : '—'}</td>
                    <td>{o.orders}</td>
                    <td>{taka(o.sales)}</td>
                    <td>{taka(o.revenue)}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </AdminBox>

      {legacy.length > 0 && (
        <AdminBox wide title="OLDER TYPED ROWS" tip="Campaigns typed here by hand before sending moved to this page. Kept for reference.">
          {legacy.map((r) => (
            <div className="mini-row" key={r.id}>
              <div className="mini-name">{r.campaign}</div>
              <div className="mini-right">
                <div className="mono">{r.open_rate}% open</div>
                <div className="mono dim">{r.click_rate}% click</div>
              </div>
              <button className="mof-item-x" onClick={async () => { await onDeleteLegacy(r.id); setTick((t) => t + 1) }}>×</button>
            </div>
          ))}
        </AdminBox>
      )}
    </div>
  )
}
