import { useState } from 'react'
import InfoTip from './InfoTip.jsx'
import { callMarketing } from '../lib/marketing.js'
import './marketing-auto.css'

// How each integration is switched on, step by step — kept next to it so the
// setup can be done months from now without asking anyone.
export const GUIDES = {
  meta: {
    title: 'META (FACEBOOK & INSTAGRAM)',
    secrets: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_IG_USER_ID', 'META_PAGE_ID', 'MARKETING_CRON_SECRET'],
    steps: [
      'Instagram app → Settings → Account type → switch to Professional (Business or Creator), and link it to your Facebook Page.',
      'business.facebook.com → make a Business portfolio if you don’t have one; add your Page, Instagram account and Ad account to it.',
      'developers.facebook.com → My Apps → Create app → type “Business” → connect it to that Business portfolio.',
      'Business settings → Users → System users → Add (Admin) → Assign assets: the Page, Instagram and Ad account (full control) → Generate new token for your app with ads_read, read_insights, instagram_basic, instagram_manage_insights, pages_read_engagement, business_management. Choose “Never expires”.',
      'Ad account ID: Ads Manager → the number next to the account name (act_…). Page ID: Page → About → Page transparency. Instagram user ID: Graph API Explorer → me/accounts?fields=instagram_business_account.',
      'Supabase → Edge Functions → Secrets → add META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_IG_USER_ID, META_PAGE_ID — and MARKETING_CRON_SECRET (any long random text) for the daily sync.',
      'Press Check connection. Green = done. Then Sync now — and, for every morning by itself, run the optional cron part at the end of supabase-migration-marketing-auto.sql.',
    ],
  },
  brevo: {
    title: 'BREVO (EMAIL CAMPAIGNS)',
    secrets: ['BREVO_API_KEY', 'BREVO_FROM_EMAIL', 'BREVO_FROM_NAME'],
    steps: [
      'The order emails already use Brevo — if those arrive, the three secrets are most likely there.',
      'brevo.com → Settings → Senders, domains & IPs → Senders: the From address must be added and verified.',
      'Best: Domains → add your shop’s domain and put the DNS records Brevo shows (DKIM, DMARC) at your domain seller — campaigns then land in inboxes, not spam.',
      'API key, if missing: Settings → SMTP & API → API keys → Generate → add it as BREVO_API_KEY in Supabase → Edge Functions → Secrets.',
      'Press Check connection. Green = done.',
    ],
  },
}

function read(r) {
  if (!r) return { tone: 'idle', word: 'Not checked' }
  if (r.ok) return { tone: 'ok', word: 'Connected', detail: r.message.replace(/^Connected\s*·\s*/, '') }
  if (/NOT_CONFIGURED/.test(r.message)) return { tone: 'idle', word: 'Not set up', detail: 'Add the secrets below, then check again.' }
  return { tone: 'bad', word: 'Problem', detail: r.message.replace(/^SAID:/, '') }
}

// One integration's status with Check connection, the steps folded away.
export function ServiceBox({ service, children }) {
  const g = GUIDES[service]
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)

  async function check() {
    setBusy(true)
    setErr('')
    const { data, error } = await callMarketing({ action: 'check' })
    setBusy(false)
    if (error) return setErr(error)
    setRes(data?.services?.[service] || null)
  }

  const s = read(res)
  return (
    <section className="mk-svc">
      <div className="mk-svc-head mono">
        <span>{g.title}</span>
        <span className={`mk-pill ${s.tone}`}>{s.word}</span>
        <button type="button" className="ab-btn" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check connection'}</button>
        <button type="button" className="mk-link" onClick={() => setOpen((v) => !v)}>{open ? 'Hide setup steps' : 'How to set up'}</button>
        {children}
      </div>
      {s.detail && <div className={`mk-svc-detail mono ${s.tone}`}>{s.detail}</div>}
      {err && <div className="ab-warn mono">{err}</div>}
      {open && (
        <div className="mk-steps">
          <ol>{g.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
          <div className="mk-secrets mono">{g.secrets.map((n) => <code key={n}>{n}</code>)}</div>
          <div className="mk-note mono">
            Keys go only in Supabase → Edge Functions → Secrets — never in a chat or on this page.
            <InfoTip>The marketing function reads them there; the browser never sees them.</InfoTip>
          </div>
        </div>
      )}
    </section>
  )
}
