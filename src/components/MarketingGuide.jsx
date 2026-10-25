import { useEffect, useState } from 'react'
import AdminBox from './AdminBox.jsx'
import { GUIDES } from './MarketingSetup.jsx'
import { callMarketing, fetchMetaAdDaily } from '../lib/marketing.js'
import './marketing-auto.css'

// Marketing → Setup guide. Everything that has to be done once, in order,
// so the automatic marketing pages work. Each step that can be checked from
// here is checked when the page opens.
const PILL = { ok: 'Done', bad: 'Not yet', idle: 'Not set up', wait: 'Checking…', manual: 'Do it yourself' }

function Step({ n, title, state = 'manual', children }) {
  return (
    <div className="mk-step">
      <div className="mk-svc-head mono">
        <span>{n}. {title}</span>
        <span className={`mk-pill ${state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : 'idle'}`}>{PILL[state]}</span>
      </div>
      <div className="mk-steps">{children}</div>
    </div>
  )
}

export default function MarketingGuide() {
  const [sql, setSql] = useState('wait')
  const [fn, setFn] = useState('wait')
  const [svc, setSvc] = useState({ brevo: 'wait', meta: 'wait' })
  const [detail, setDetail] = useState({})
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setSql('wait'); setFn('wait'); setSvc({ brevo: 'wait', meta: 'wait' })
    const today = new Date().toISOString().slice(0, 10)
    fetchMetaAdDaily(today, today).then(({ error }) => setSql(error ? 'bad' : 'ok'))
    callMarketing({ action: 'check' }).then(({ data, error }) => {
      if (error) {
        setFn(/deployed/.test(error) ? 'bad' : 'ok')
        setDetail({ fn: error })
        setSvc({ brevo: 'bad', meta: 'bad' })
        return
      }
      setFn('ok')
      const s = data?.services || {}
      const one = (r) => (!r ? 'bad' : r.ok ? 'ok' : /NOT_CONFIGURED/.test(r.message) ? 'idle' : 'bad')
      setSvc({ brevo: one(s.brevo), meta: one(s.meta) })
      setDetail({ brevo: s.brevo?.message, meta: s.meta?.message })
    })
  }, [tick])

  const said = (m) => m && <div className="mk-svc-detail mono">{String(m).replace(/^SAID:/, '')}</div>

  return (
    <div className="mk">
      <AdminBox
        wide
        title="SETUP GUIDE — DO THESE ONCE, IN ORDER"
        side={<button type="button" className="ab-btn ghost" onClick={() => setTick((t) => t + 1)}>Check again</button>}
        tip="Ad spend / ROAS, Email campaigns and Social tracking fill themselves in once these steps are done. The ticks are checked live each time this page opens."
      >
        <div className="mk-note mono" style={{ marginBottom: 12 }}>
          Keys and tokens go only in Supabase → Edge Functions → Secrets — never in a chat, an email or this page.
        </div>

        <Step n={1} title="RUN THE SQL" state={sql}>
          <ol>
            <li>Supabase → SQL Editor → New query.</li>
            <li>Paste the whole of <code>supabase-migration-marketing-auto.sql</code> (only the part above “OPTIONAL”) → Run.</li>
            <li>It adds the Meta ad spend table and the new columns for email campaigns and followers. Safe to run twice.</li>
          </ol>
        </Step>

        <Step n={2} title="DEPLOY THE MARKETING FUNCTION" state={fn}>
          <ol>
            <li>Supabase → Edge Functions → Deploy a new function → Via Editor.</li>
            <li>Name it exactly <code>marketing</code>.</li>
            <li>Delete the sample code, paste all of <code>supabase/functions/marketing/index.ts</code> → Deploy.</li>
            <li>Open the function → Details / Settings → turn <b>Verify JWT</b> OFF → Save. (The function checks the admin itself; this only lets the daily sync in step 5 reach it.)</li>
            <li>Edge Functions → Secrets: <code>ADMIN_EMAIL</code> must be the admin's email (it's likely already there for the other functions).</li>
          </ol>
          {fn === 'bad' && said(detail.fn)}
        </Step>

        <Step n={3} title="BREVO — EMAIL CAMPAIGNS" state={svc.brevo}>
          <ol>{GUIDES.brevo.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
          <div className="mk-secrets mono">{GUIDES.brevo.secrets.map((n) => <code key={n}>{n}</code>)}</div>
          <p>When you buy your domain: keep Brevo for sending. Add the domain in Brevo → Domains, put its DNS records at the domain seller, then change <code>BREVO_FROM_EMAIL</code> to your domain address (hello@yourdomain…). A mailbox from the domain seller is just your inbox for reading replies — it doesn't replace Brevo.</p>
          {svc.brevo !== 'idle' && said(detail.brevo)}
        </Step>

        <Step n={4} title="META — FACEBOOK & INSTAGRAM (AD SPEND + FOLLOWERS)" state={svc.meta}>
          <ol>{GUIDES.meta.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
          <div className="mk-secrets mono">{GUIDES.meta.secrets.map((n) => <code key={n}>{n}</code>)}</div>
          <p>Only ad spend wanted for now? <code>META_ACCESS_TOKEN</code> + <code>META_AD_ACCOUNT_ID</code> are enough. Followers need <code>META_IG_USER_ID</code> / <code>META_PAGE_ID</code> too.</p>
          {svc.meta !== 'idle' && said(detail.meta)}
        </Step>

        <Step n={5} title="DAILY META SYNC (OPTIONAL)">
          <ol>
            <li>Only after step 4 is green.</li>
            <li>Supabase → Database → Extensions → turn on <code>pg_cron</code> and <code>pg_net</code>.</li>
            <li>Edge Functions → Secrets → add <code>MARKETING_CRON_SECRET</code> = any long random text.</li>
            <li>SQL Editor → run the “OPTIONAL” part at the end of <code>supabase-migration-marketing-auto.sql</code>, with your project URL and that same secret put in.</li>
            <li>From then on, every morning yesterday's ad spend and today's follower counts come in by themselves. Without it, press Sync now whenever you want fresh numbers.</li>
          </ol>
        </Step>
      </AdminBox>

      <AdminBox wide title="HOW TO USE IT, DAY TO DAY" tip="What to do so the numbers come out right.">
        <div className="mk-steps">
          <ol>
            <li><b>Every ad:</b> Marketing → Tracked links → source Facebook ad / Instagram ad, pick the drop as Campaign → paste that link as the ad's Website URL. That's how its orders are counted for ROAS.</li>
            <li><b>Before Meta is connected:</b> type each ad's cost in Products → Cost &amp; margin → Drop profit (kind Ads, Where = Facebook or Instagram). Ad spend / ROAS uses those. Once Meta is synced, Meta's numbers are used instead — never both.</li>
            <li><b>Email:</b> Marketing → Email campaigns → write it → Send test to yourself → Send. A day later press Refresh stats for opens and clicks; orders from the button show by themselves.</li>
            <li><b>Followers:</b> Marketing → Social tracking. Instagram / Facebook come from Meta; type TikTok or others by hand there.</li>
            <li><b>Posts, stories, bio:</b> make their links in Tracked links too — they show in Overview → Order sources.</li>
          </ol>
        </div>
      </AdminBox>
    </div>
  )
}
