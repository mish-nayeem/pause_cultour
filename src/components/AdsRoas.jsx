import { useEffect, useMemo, useState } from 'react'
import AdminBox from './AdminBox.jsx'
import { ServiceBox } from './MarketingSetup.jsx'
import { callMarketing, fetchMetaAdDaily } from '../lib/marketing.js'
import { fetchDropCosts } from '../lib/dropMoney.js'
import { campaignSlug } from './LinkGenerator.jsx'
import { orderMoney, unsold } from '../lib/admin.js'
import { PRESETS, rangeFor, toInput, DAY } from '../lib/periods.js'
import './marketing-auto.css'

function taka(n) {
  const v = Math.round(Number(n || 0))
  return (v < 0 ? '− ' : '') + '৳ ' + Math.abs(v).toLocaleString()
}

const CHANNELS = [
  { key: 'fb_ad', label: 'Facebook ads' },
  { key: 'insta_ad', label: 'Instagram ads' },
  { key: 'other_ad', label: 'Other ads' },
]

const fromMeta = { facebook: 'fb_ad', instagram: 'insta_ad', other: 'other_ad' }

// A typed ad cost (Drop profit) → its channel, from what was written as "where".
function channelOfLabel(label) {
  const l = String(label || '').toLowerCase()
  if (/insta|\big\b/.test(l)) return 'insta_ad'
  if (/face|\bfb\b|meta/.test(l)) return 'fb_ad'
  return 'other_ad'
}

function channelOfOrder(o) {
  const s = String(o.utm_source || '').toLowerCase()
  if (s === 'fb_ad' || s === 'insta_ad') return s
  if (String(o.utm_medium || '').toLowerCase() === 'paid') return 'other_ad'
  return null
}

const ymd = (ms) => toInput(new Date(ms))
const roas = (sales, spend) => (spend > 0 ? `${(sales / spend).toFixed(1)}×` : '—')

// Marketing → Ad spend / ROAS. Spend comes from Meta (synced) — or, until
// Meta is connected, from the ad costs typed in Drop profit; sales and
// revenue come from the orders placed through ad links (Marketing → Links,
// source Facebook ad / Instagram ad). Nothing is typed here.
export default function AdsRoas({ orders, legacy = [], onDeleteLegacy }) {
  const [preset, setPreset] = useState('30d')
  const [from, setFrom] = useState(() => toInput(new Date(Date.now() - 29 * DAY)))
  const [to, setTo] = useState(() => toInput(new Date()))
  const range = useMemo(() => rangeFor(preset, { from, to, firstOrderAt: orders.reduce((m, o) => Math.min(m, new Date(o.created_at).getTime()), Date.now()) }), [preset, from, to, orders])
  const [meta, setMeta] = useState([])
  const [costs, setCosts] = useState([])
  const [note, setNote] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    fetchMetaAdDaily(ymd(range.start), ymd(range.end - 1)).then(({ rows, error }) => {
      setMeta(rows)
      if (error) setNote(error)
    })
  }, [range.start, range.end, tick])
  useEffect(() => { fetchDropCosts().then(({ costs }) => setCosts(costs)) }, [])

  async function sync() {
    setSyncing(true)
    setNote('')
    const { data, error } = await callMarketing({ action: 'meta_sync', days: Math.ceil((Date.now() - range.start) / DAY) + 1 })
    setSyncing(false)
    if (error) return setNote(error)
    setNote(`Synced from Meta — ${typeof data?.ads === 'object' ? `${data.ads.rows} day/campaign rows` : data?.ads}.`)
    setTick((t) => t + 1)
  }

  const usingMeta = meta.length > 0
  const typedAds = costs.filter((c) => c.kind === 'ads').filter((c) => {
    const t = new Date(c.spent_on + 'T00:00:00').getTime()
    return t >= range.start && t < range.end
  })

  const rows = useMemo(() => {
    const m = new Map(CHANNELS.map((c) => [c.key, { spend: 0, clicks: 0, impressions: 0, orders: 0, sales: 0, revenue: 0 }]))
    if (usingMeta) for (const r of meta) {
      const e = m.get(fromMeta[r.platform] || 'other_ad')
      e.spend += Number(r.spend)
      e.clicks += Number(r.clicks)
      e.impressions += Number(r.impressions)
    } else for (const c of typedAds) m.get(channelOfLabel(c.label)).spend += Number(c.amount)
    for (const o of orders) {
      const t = new Date(o.created_at).getTime()
      if (t < range.start || t >= range.end) continue
      const ch = channelOfOrder(o)
      if (!ch) continue
      const e = m.get(ch)
      if (!unsold(o)) {
        e.orders++
        e.sales += Number(o.total ?? o.subtotal ?? 0)
      }
      e.revenue += orderMoney(o).toShop
    }
    return CHANNELS.map((c) => ({ ...c, ...m.get(c.key) }))
  }, [meta, typedAds, orders, range, usingMeta])

  const total = rows.reduce((a, r) => ({ spend: a.spend + r.spend, orders: a.orders + r.orders, sales: a.sales + r.sales, revenue: a.revenue + r.revenue }), { spend: 0, orders: 0, sales: 0, revenue: 0 })

  // By campaign — the ad links' Campaign against that drop's typed ad spend.
  const campaigns = useMemo(() => {
    const m = new Map()
    const add = (k) => m.get(k) || m.set(k, { spend: 0, orders: 0, sales: 0, revenue: 0 }).get(k)
    for (const o of orders) {
      const t = new Date(o.created_at).getTime()
      if (t < range.start || t >= range.end || !channelOfOrder(o) || !o.utm_campaign) continue
      const e = add(String(o.utm_campaign).toLowerCase())
      if (!unsold(o)) { e.orders++; e.sales += Number(o.total ?? o.subtotal ?? 0) }
      e.revenue += orderMoney(o).toShop
    }
    for (const c of typedAds) add(campaignSlug(c.drop_name)).spend += Number(c.amount)
    return [...m.entries()].sort((a, b) => b[1].sales - a[1].sales)
  }, [orders, typedAds, range])

  const metaCampaigns = useMemo(() => {
    const m = new Map()
    for (const r of meta) {
      const k = `${r.campaign_name || '(no name)'}`
      const e = m.get(k) || { spend: 0, clicks: 0, impressions: 0, platforms: new Set() }
      e.spend += Number(r.spend); e.clicks += Number(r.clicks); e.impressions += Number(r.impressions); e.platforms.add(r.platform)
      m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => b[1].spend - a[1].spend)
  }, [meta])

  return (
    <div className="mk">
      <ServiceBox service="meta">
        <button type="button" className="ab-btn" disabled={syncing} onClick={sync}>{syncing ? 'Syncing…' : 'Sync now'}</button>
      </ServiceBox>
      {note && <div className="ab-note mono">{note}</div>}

      <div className="ovc-range">
        <div className="chips mono">
          {PRESETS.filter((p) => p.key !== 'today').map((p) => (
            <button key={p.key} type="button" className={`chip ${preset === p.key ? 'on' : ''}`} onClick={() => setPreset(p.key)}>{p.label.toUpperCase()}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="ovc-dates mono">
            <label>From <input type="date" className="ab-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="date" className="ab-input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )}
      </div>

      <AdminBox
        wide
        title="AD SPEND & RETURN"
        side={usingMeta ? 'spend from Meta' : 'spend typed in Drop profit'}
        tip={
          <>
            <p><b>Spend</b> comes from Meta when it's connected and synced; until then from the ad costs you type in Products → Cost &amp; margin → Drop profit (their "Where" — Facebook / Instagram — picks the row). Never both, so nothing is counted twice.</p>
            <p><b>Orders, sales, revenue</b> come by themselves from orders placed through ad links — make them in Marketing → Links with source Facebook ad / Instagram ad, and paste them as the ad's Website URL.</p>
            <p><b>ROAS</b> = sales ÷ spend. Above 3× is usually healthy for clothing; under 1× loses money.</p>
          </>
        }
      >
        <div className="ovc-src-wrap">
          <table className="ovc-table ovc-src mono">
            <thead><tr><th>Channel</th><th>Spend</th>{usingMeta && <th>Clicks</th>}<th>Orders</th><th>Sales</th><th>Revenue</th><th>ROAS</th><th>Revenue − spend</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><span className="ovc-src-name">{r.label}</span></td>
                  <td>{taka(r.spend)}</td>
                  {usingMeta && <td>{r.clicks.toLocaleString()}</td>}
                  <td>{r.orders}</td>
                  <td>{taka(r.sales)}</td>
                  <td>{taka(r.revenue)}</td>
                  <td><b>{roas(r.sales, r.spend)}</b></td>
                  <td className={r.revenue - r.spend < 0 ? 'mk-neg' : ''}>{taka(r.revenue - r.spend)}</td>
                </tr>
              ))}
              <tr>
                <td><b>All ads</b></td><td><b>{taka(total.spend)}</b></td>{usingMeta && <td />}<td><b>{total.orders}</b></td><td><b>{taka(total.sales)}</b></td><td><b>{taka(total.revenue)}</b></td><td><b>{roas(total.sales, total.spend)}</b></td><td className={total.revenue - total.spend < 0 ? 'mk-neg' : ''}><b>{taka(total.revenue - total.spend)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </AdminBox>

      <AdminBox
        wide
        title="BY CAMPAIGN (YOUR AD LINKS)"
        tip="Ad links made with a Campaign (a drop, or a name) — their orders against the ad spend typed for that drop in Drop profit."
      >
        {campaigns.length === 0 ? <div className="ab-empty mono">No ad links with a campaign in these dates.</div> : (
          <div className="ovc-src-wrap">
            <table className="ovc-table ovc-src mono">
              <thead><tr><th>Campaign</th><th>Typed spend</th><th>Orders</th><th>Sales</th><th>Revenue</th><th>ROAS</th></tr></thead>
              <tbody>{campaigns.map(([k, e]) => (
                <tr key={k}><td>{k}</td><td>{taka(e.spend)}</td><td>{e.orders}</td><td>{taka(e.sales)}</td><td>{taka(e.revenue)}</td><td><b>{roas(e.sales, e.spend)}</b></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </AdminBox>

      {usingMeta && (
        <AdminBox wide title="META CAMPAIGNS" tip="Each campaign as Meta reports it, in these dates. CTR = clicks ÷ impressions; CPC = spend ÷ clicks.">
          <div className="ovc-src-wrap">
            <table className="ovc-table ovc-src mono">
              <thead><tr><th>Campaign</th><th>Where</th><th>Spend</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>CPC</th></tr></thead>
              <tbody>{metaCampaigns.map(([k, e]) => (
                <tr key={k}>
                  <td>{k}</td><td>{[...e.platforms].join(' · ')}</td><td>{taka(e.spend)}</td><td>{e.impressions.toLocaleString()}</td><td>{e.clicks.toLocaleString()}</td>
                  <td>{e.impressions ? `${((e.clicks / e.impressions) * 100).toFixed(2)}%` : '—'}</td><td>{e.clicks ? taka(e.spend / e.clicks) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </AdminBox>
      )}

      {legacy.length > 0 && (
        <AdminBox wide title="OLDER TYPED ROWS" tip="Rows typed here before this page filled itself in. Kept for reference — not counted above. Delete them when you no longer need them.">
          {legacy.map((r) => (
            <div className="mini-row" key={r.id}>
              <div className="mini-name">{r.channel}</div>
              <div className="mini-right">
                <div className="mono">{taka(r.spend)} → {taka(r.revenue)}</div>
                <div className="mono dim">{r.spend > 0 ? (r.revenue / r.spend).toFixed(1) : '0.0'}× ROAS</div>
              </div>
              <button className="mof-item-x" onClick={() => onDeleteLegacy(r.id)}>×</button>
            </div>
          ))}
        </AdminBox>
      )}
    </div>
  )
}

