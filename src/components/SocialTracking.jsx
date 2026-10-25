import { useMemo, useState } from 'react'
import AdminBox from './AdminBox.jsx'
import { ServiceBox } from './MarketingSetup.jsx'
import { callMarketing } from '../lib/marketing.js'
import { DAY } from '../lib/periods.js'
import './marketing-auto.css'

const LINE = { Instagram: '#c13584', Facebook: '#1877f2' }

const dayOf = (r) => r.captured_on || String(r.created_at || '').slice(0, 10)

function change(series, days) {
  if (series.length < 2) return null
  const last = series[series.length - 1]
  const cut = new Date(dayOf(last) + 'T00:00:00').getTime() - days * DAY
  const before = [...series].reverse().find((r) => new Date(dayOf(r) + 'T00:00:00').getTime() <= cut)
  return before ? Number(last.followers) - Number(before.followers) : null
}

function Change({ n, label }) {
  if (n == null) return <span>{label}: —</span>
  return <span>{label}: <span className={n > 0 ? 'up' : n < 0 ? 'down' : ''}>{n > 0 ? '+' : ''}{n.toLocaleString()}</span></span>
}

// Followers over time, one line per platform synced from Meta.
function FollowerChart({ series }) {
  const all = Object.values(series).flat()
  if (all.length < 2) return <div className="ab-empty mono">The line starts once there are two days of syncs.</div>
  const W = 960, H = 220, P = 44
  const ts = all.map((r) => new Date(dayOf(r) + 'T00:00:00').getTime())
  const t0 = Math.min(...ts), t1 = Math.max(...ts) || t0 + DAY
  const vs = all.map((r) => Number(r.followers))
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const pad = Math.max(1, Math.round((hi - lo) * 0.1))
  const y0 = lo - pad, y1 = hi + pad
  const x = (t) => P + ((t - t0) / Math.max(DAY, t1 - t0)) * (W - P - 8)
  const y = (v) => H - 22 - ((v - y0) / (y1 - y0)) * (H - 34)
  const fmt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return (
    <svg className="mk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Followers over time">
      {[y0, (y0 + y1) / 2, y1].map((v, i) => (
        <g key={i}>
          <line x1={P} x2={W - 8} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity="0.12" />
          <text x={P - 6} y={y(v) + 3} fontSize="10" textAnchor="end" fill="currentColor" opacity="0.6">{Math.round(v).toLocaleString()}</text>
        </g>
      ))}
      <text x={P} y={H - 6} fontSize="10" fill="currentColor" opacity="0.6">{fmt(t0)}</text>
      <text x={W - 8} y={H - 6} fontSize="10" textAnchor="end" fill="currentColor" opacity="0.6">{fmt(t1)}</text>
      {Object.entries(series).map(([p, rows]) => (
        <polyline
          key={p}
          fill="none"
          stroke={LINE[p] || 'currentColor'}
          strokeWidth="2"
          points={rows.map((r) => `${x(new Date(dayOf(r) + 'T00:00:00').getTime())},${y(Number(r.followers))}`).join(' ')}
        />
      ))}
    </svg>
  )
}

// Marketing → Social. Instagram and Facebook followers come from Meta by
// themselves (daily sync); anything else — TikTok, say — is still typed in.
export default function SocialTracking({ rows, onSynced, onAdd, onDelete }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState({ platform: '', followers: '', engagement_rate: '' })
  const [saving, setSaving] = useState(false)

  async function add(e) {
    e.preventDefault()
    if (!draft.platform.trim()) return
    setSaving(true)
    const error = await onAdd({ platform: draft.platform.trim(), followers: Number(draft.followers) || 0, engagement_rate: Number(draft.engagement_rate) || 0 })
    setSaving(false)
    if (error) return setNote("Couldn't save that row. Try again.")
    setDraft({ platform: '', followers: '', engagement_rate: '' })
  }

  async function sync() {
    setBusy(true)
    setNote('')
    const { data, error } = await callMarketing({ action: 'meta_sync', days: 3 })
    setBusy(false)
    if (error) return setNote(error)
    setNote(data?.followers?.length ? `Synced — ${data.followers.join(', ')}.` : 'Synced, but no Instagram / Page id is set — add META_IG_USER_ID and META_PAGE_ID.')
    onSynced?.()
  }

  const sorted = useMemo(() => [...rows].sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || String(a.created_at).localeCompare(String(b.created_at))), [rows])
  const series = useMemo(() => {
    const m = {}
    for (const r of sorted) if (r.source === 'meta') (m[r.platform] ||= []).push(r)
    return m
  }, [sorted])
  const typed = sorted.filter((r) => r.source !== 'meta').reverse()

  return (
    <div className="mk">
      <ServiceBox service="meta">
        <button type="button" className="ab-btn" disabled={busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync now'}</button>
      </ServiceBox>
      {note && <div className="ab-note mono">{note}</div>}

      <AdminBox wide title="FOLLOWERS (FROM META)" tip="One count a day per platform, taken by the Meta sync — press Sync now, or turn on the daily sync (end of supabase-migration-marketing-auto.sql). Change = today's count minus the count 7 / 30 days before.">
        {Object.keys(series).length === 0 ? (
          <div className="ab-empty mono">Nothing synced yet — connect Meta above, then Sync now.</div>
        ) : (
          <>
            <div className="mk-tiles">
              {Object.entries(series).map(([p, s]) => {
                const last = s[s.length - 1]
                return (
                  <div className="mk-tile" key={p}>
                    <div className="mk-tile-name mono">{p.toUpperCase()}</div>
                    <div className="mk-tile-num">{Number(last.followers).toLocaleString()}</div>
                    <div className="mk-tile-ch mono"><Change n={change(s, 7)} label="7 days" /> · <Change n={change(s, 30)} label="30 days" /></div>
                    {last.media_count != null && <div className="mk-tile-ch mono">{last.media_count} posts · as of {dayOf(last)}</div>}
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 14 }}><FollowerChart series={series} /></div>
          </>
        )}
      </AdminBox>

      <AdminBox wide title="TYPED BY HAND" tip="Platforms Meta doesn't cover (TikTok, YouTube…) or counts from before the sync.">
        <form className="ab-row" style={{ marginBottom: 12 }} onSubmit={add}>
          <input className="ab-input" style={{ flex: 2, width: 'auto' }} value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })} placeholder="TikTok, YouTube…" />
          <input className="ab-input" style={{ flex: 1, width: 'auto' }} type="number" value={draft.followers} onChange={(e) => setDraft({ ...draft, followers: e.target.value })} placeholder="Followers" />
          <input className="ab-input" style={{ flex: 1, width: 'auto' }} type="number" value={draft.engagement_rate} onChange={(e) => setDraft({ ...draft, engagement_rate: e.target.value })} placeholder="Engagement %" />
          <button type="submit" className="ab-btn" disabled={saving}>{saving ? 'Saving…' : 'Add'}</button>
        </form>
        {typed.length === 0 && <div className="ab-empty mono">Nothing typed yet.</div>}
        {typed.map((r) => (
          <div className="mini-row" key={r.id}>
            <div className="mini-name">{r.platform}</div>
            <div className="mini-right">
              <div className="mono">{Number(r.followers).toLocaleString()} followers</div>
              <div className="mono dim">{r.engagement_rate}% engagement · {dayOf(r)}</div>
            </div>
            <button className="mof-item-x" onClick={() => onDelete(r.id)}>×</button>
          </div>
        ))}
      </AdminBox>
    </div>
  )
}
