import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl } from '../lib/images.js'
import './analytics-manager.css'

const MIGRATION = 'has supabase-migration-analytics-v2.sql been run?'

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function taka(n) {
  return '৳ ' + Math.round(Number(n || 0)).toLocaleString()
}

function pct(a, b) {
  return b > 0 ? (a / b) * 100 : 0
}

// "↑ 24%" / "↓ 8%" against the period before, or nothing to compare with.
function change(now, before) {
  if (!before) return null
  const d = ((now - before) / before) * 100
  return { up: d >= 0, text: `${d >= 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(0)}% vs previous` }
}

// Dhaka time, whatever the admin's own clock says.
function dhaka(iso) {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  return d
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Where a visit came from, from the referrer's address.
function sourceName(src) {
  const s = (src || '').toLowerCase()
  if (!s || s === 'direct') return 'Direct / typed in'
  if (s.includes('instagram')) return 'Instagram'
  if (s.includes('facebook') || s.includes('fb.')) return 'Facebook'
  if (s.includes('messenger')) return 'Messenger'
  if (s.includes('tiktok')) return 'TikTok'
  if (s.includes('google')) return 'Google'
  if (s.includes('youtube')) return 'YouTube'
  if (s.includes('whatsapp') || s === 'wa.me') return 'WhatsApp'
  if (s.includes('t.co') || s.includes('twitter') || s.includes('x.com')) return 'X / Twitter'
  if (s.includes('workers.dev') || s.includes(window.location.hostname)) return 'Direct / typed in'
  return s
}

function pageType(path) {
  const p = (path || '').split('?')[0]
  if (p === '/') return 'Homepage'
  if (p === '/shop') return 'Shop'
  if (p.startsWith('/product/')) return 'Product pages'
  if (p.startsWith('/lookbook')) return 'Lookbook'
  if (p === '/cart') return 'Cart'
  if (p === '/checkout') return 'Checkout'
  if (p === '/order-confirmed') return 'Order confirmed'
  if (p === '/about') return 'About'
  if (p === '/track') return 'Track order'
  if (p.startsWith('/support')) return 'Support pages'
  if (p === '/login' || p === '/account') return 'Login / account'
  return p
}

// Admin → Analytics. The visitor figures come from admin_analytics() — added
// up in the database (supabase-migration-analytics-v2.sql); the sales figures
// from the orders already loaded. One date range drives every tab.
export default function AnalyticsManager({ sub, orders, products }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    supabase.rpc('admin_analytics', { p_days: days }).then(({ data, error }) => {
      if (!alive) return
      setLoading(false)
      if (error) {
        console.error('[Supabase] admin_analytics failed:', error.message)
        setError(`Couldn't load visitor figures — ${MIGRATION}`)
        setData(null)
        return
      }
      setData(data)
    })
    return () => { alive = false }
  }, [days])

  const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products])

  // The orders side, for this range and the one before it.
  const sales = useMemo(() => {
    const now = Date.now()
    const since = now - days * 86400000
    const prevSince = now - days * 2 * 86400000
    const live = orders.filter((o) => o.status !== 'cancelled')
    const inRange = live.filter((o) => new Date(o.created_at).getTime() >= since)
    const prev = live.filter((o) => {
      const t = new Date(o.created_at).getTime()
      return t >= prevSince && t < since
    })
    const value = (list) => list.reduce((s, o) => s + Number(o.total ?? o.subtotal ?? 0), 0)

    const byDay = new Map()
    const byHour = Array(24).fill(0)
    const byWeekday = Array(7).fill(0)
    const byDistrict = new Map()
    const pieces = new Map() // product id → { pcs, orders }
    for (const o of inRange) {
      const d = dhaka(o.created_at)
      byDay.set(dayKey(d), (byDay.get(dayKey(d)) || 0) + 1)
      byHour[d.getHours()] += 1
      byWeekday[d.getDay()] += 1
      const area = o.customer_area || 'Unknown'
      const a = byDistrict.get(area) || { name: area, orders: 0, value: 0 }
      a.orders += 1
      a.value += Number(o.total ?? o.subtotal ?? 0)
      byDistrict.set(area, a)
      const seen = new Set()
      for (const it of o.order_items || []) {
        const id = String(it.product_id)
        const p = pieces.get(id) || { pcs: 0, orders: 0 }
        p.pcs += Number(it.qty) || 0
        if (!seen.has(id)) p.orders += 1
        seen.add(id)
        pieces.set(id, p)
      }
    }

    return {
      orders: inRange.length,
      prevOrders: prev.length,
      revenue: value(inRange),
      prevRevenue: value(prev),
      byDay,
      byHour,
      byWeekday,
      districts: [...byDistrict.values()].sort((a, b) => b.orders - a.orders),
      pieces,
    }
  }, [orders, days])

  // Every day in the range, oldest first, with visitors and orders.
  const daily = useMemo(() => {
    const visitors = new Map((data?.daily || []).map((d) => [d.day, d.visitors]))
    const out = []
    const today = dhaka(new Date().toISOString())
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const k = dayKey(d)
      out.push({
        key: k,
        label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        visitors: visitors.get(k) || 0,
        orders: sales.byDay.get(k) || 0,
      })
    }
    return out
  }, [data, sales, days])

  const visitors = data?.visitors || 0

  return (
    <div className="an">
      <div className="an-range mono" role="radiogroup" aria-label="Date range">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            role="radio"
            aria-checked={days === r.days}
            className={days === r.days ? 'on' : ''}
            onClick={() => setDays(r.days)}
          >
            Last {r.label}
          </button>
        ))}
        {loading && <span className="an-loading">Loading…</span>}
      </div>

      {error && <div className="err-banner mono">{error}</div>}

      {sub === 'summary' && (
        <>
          <div className="an-kpis">
            <Kpi label="VISITORS" value={visitors.toLocaleString()} delta={change(visitors, data?.prev_visitors)} note="One per browser visit" />
            <Kpi label="ORDERS" value={sales.orders} delta={change(sales.orders, sales.prevOrders)} note="Not counting cancelled" />
            <Kpi label="CONVERSION" value={`${pct(sales.orders, visitors).toFixed(1)}%`} note="Orders ÷ visitors" />
            <Kpi label="SALES" value={taka(sales.revenue)} delta={change(sales.revenue, sales.prevRevenue)} note="Orders placed in the range" />
            <Kpi label="AVERAGE ORDER" value={taka(sales.orders ? sales.revenue / sales.orders : 0)} />
            <Kpi label="PAGE VIEWS" value={(data?.views || 0).toLocaleString()} />
            <Kpi label="PAGES PER VISIT" value={(visitors ? data.views / visitors : 0).toFixed(1)} />
            <Kpi label="BOUNCE" value={`${pct(data?.bounced || 0, visitors).toFixed(0)}%`} note="Left after one page" />
          </div>

          <section className="panel">
            <div className="panel-label mono">VISITORS PER DAY</div>
            <Columns rows={daily.map((d) => ({ key: d.key, label: d.label, value: d.visitors, tip: `${d.label}: ${d.visitors} visitors` }))} />
          </section>

          <section className="panel">
            <div className="panel-label mono">ORDERS PER DAY</div>
            <Columns rows={daily.map((d) => ({ key: d.key, label: d.label, value: d.orders, tip: `${d.label}: ${d.orders} orders` }))} />
          </section>

          <section className="panel">
            <div className="panel-label mono">FROM VISIT TO ORDER</div>
            <div className="panel-note">How many visitors reached each step, and how many dropped off before the next.</div>
            <Funnel f={data?.funnel} />
          </section>

          <section className="panel">
            <div className="panel-label mono">PHONE OR COMPUTER</div>
            <Bars
              rows={[
                ['mobile', 'Phone'],
                ['tablet', 'Tablet'],
                ['desktop', 'Computer'],
                ['unknown', 'Not recorded yet'],
              ]
                .map(([k, label]) => ({ name: label, value: data?.devices?.[k] || 0 }))
                .filter((r) => r.value > 0)}
              total={visitors}
              unit="visitors"
              empty="No visits in this range."
            />
          </section>
        </>
      )}

      {sub === 'products' && (
        <section className="panel">
          <div className="panel-label mono">PRODUCTS · VIEWED VS BOUGHT</div>
          <div className="panel-note">
            Most-viewed first. A high view count with few orders is worth a look — the price, the photos
            or the sizes left.
          </div>
          {(data?.products || []).length === 0 && <div className="empty mono">No product views in this range.</div>}
          <div className="an-plist">
            {(data?.products || []).map((r) => {
              const p = productsById.get(String(r.id))
              const s = sales.pieces.get(String(r.id)) || { pcs: 0, orders: 0 }
              const rate = pct(s.orders, r.visitors)
              return (
                <div className={`mini-row an-prow ${r.visitors >= 10 && s.orders === 0 ? 'cold' : ''}`} key={r.id}>
                  <div className="sl-who">
                    <span className="sl-thumb">{p?.images?.[0] && <img src={imgUrl(p.images[0], { w: 100 })} alt="" loading="lazy" />}</span>
                    <div>
                      <div className="mini-name">{p ? p.name : r.id}</div>
                      <div className="mini-id mono">{[p?.variant, r.id].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                  <div className="an-pnums mono">
                    <span><b>{r.views}</b> views</span>
                    <span><b>{r.visitors}</b> people</span>
                    <span><b>{s.pcs}</b> sold</span>
                    <span className="an-rate"><b>{rate.toFixed(0)}%</b> bought</span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {sub === 'sources' && (
        <section className="panel">
          <div className="panel-label mono">WHERE VISITORS COME FROM</div>
          <div className="panel-note">
            The site a visitor clicked through from. Links opened inside the Instagram or Facebook app
            sometimes arrive without one and count as Direct. For orders by tracked link, see Overview →
            Order sources.
          </div>
          <Bars
            rows={(() => {
              const m = new Map()
              for (const r of data?.sources || []) {
                const n = sourceName(r.source)
                m.set(n, (m.get(n) || 0) + r.visitors)
              }
              return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
            })()}
            total={visitors}
            unit="visitors"
            empty="No visits in this range."
          />
        </section>
      )}

      {sub === 'timing' && (
        <>
          <section className="panel">
            <div className="panel-label mono">ORDERS BY HOUR · DHAKA TIME</div>
            <div className="panel-note">When orders come in — a good guide for when to post.</div>
            <Columns
              rows={sales.byHour.map((n, h) => ({ key: h, label: hourLabel(h), value: n, tip: `${hourLabel(h)}: ${n} orders` }))}
              everyLabel={3}
            />
          </section>
          <section className="panel">
            <div className="panel-label mono">VISITORS BY HOUR · DHAKA TIME</div>
            <Columns
              rows={Array.from({ length: 24 }, (_, h) => {
                const n = (data?.hours || []).find((x) => x.hour === h)?.visitors || 0
                return { key: h, label: hourLabel(h), value: n, tip: `${hourLabel(h)}: ${n} visitors` }
              })}
              everyLabel={3}
            />
          </section>
          <section className="panel">
            <div className="panel-label mono">ORDERS BY DAY OF THE WEEK</div>
            <Bars
              rows={WEEKDAYS.map((d, i) => ({ name: d, value: sales.byWeekday[i] }))}
              total={sales.orders}
              unit="orders"
              keepOrder
              empty="No orders in this range."
            />
          </section>
        </>
      )}

      {sub === 'location' && (
        <section className="panel">
          <div className="panel-label mono">ORDERS BY DISTRICT</div>
          <Bars
            rows={sales.districts.map((d) => ({ name: d.name, value: d.orders, extra: taka(d.value) }))}
            total={sales.orders}
            unit="orders"
            empty="No orders in this range."
          />
        </section>
      )}

      {sub === 'pages' && (
        <section className="panel">
          <div className="panel-label mono">PAGES</div>
          <div className="panel-note">
            Views per kind of page, and — for visits that started there — how many left without
            opening a second page.
          </div>
          <Pages data={data} />
        </section>
      )}
    </div>
  )
}

function hourLabel(h) {
  const am = h < 12
  const n = h % 12 === 0 ? 12 : h % 12
  return `${n}${am ? 'am' : 'pm'}`
}

function Kpi({ label, value, delta, note }) {
  return (
    <div className="an-kpi">
      <div className="an-kpi-label mono">{label}</div>
      <div className="an-kpi-value">{value}</div>
      {delta && <div className={`an-kpi-delta mono ${delta.up ? 'up' : 'down'}`}>{delta.text}</div>}
      {note && <div className="an-kpi-note mono">{note}</div>}
    </div>
  )
}

// Upright bars over time (or hours); hover or tap one for its number.
function Columns({ rows, everyLabel }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const step = everyLabel || Math.max(1, Math.ceil(rows.length / 8))
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (!total) return <div className="empty mono">Nothing in this range yet.</div>
  return (
    <div className="an-cols" role="img" aria-label={rows.map((r) => r.tip).join(', ')}>
      <div className="an-cols-plot">
        {rows.map((r) => (
          <div className="an-col" key={r.key} data-tip={r.tip} tabIndex={0}>
            <i style={{ height: `${(r.value / max) * 100}%` }} className={r.value ? '' : 'zero'} />
          </div>
        ))}
      </div>
      <div className="an-cols-axis mono">
        {rows.map((r, i) => (
          <span key={r.key}>{i % step === 0 ? r.label : ''}</span>
        ))}
      </div>
      <div className="an-cols-max mono">max {max}</div>
    </div>
  )
}

// Sideways bars with the count and share beside each.
function Bars({ rows, total, unit, empty, keepOrder = false }) {
  const list = keepOrder ? rows : [...rows].sort((a, b) => b.value - a.value)
  const max = Math.max(1, ...list.map((r) => r.value))
  if (!list.length || !list.some((r) => r.value)) return <div className="empty mono">{empty}</div>
  return (
    <div className="an-bars">
      {list.map((r) => (
        <div className="an-bar" key={r.name}>
          <div className="an-bar-top">
            <span className="an-bar-name">{r.name}</span>
            <span className="an-bar-val mono">
              {r.value} {r.value === 1 ? unit.replace(/s$/, '') : unit}
              <span className="dim"> · {pct(r.value, total).toFixed(0)}%{r.extra ? ` · ${r.extra}` : ''}</span>
            </span>
          </div>
          <div className="an-bar-track"><i style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

function Funnel({ f }) {
  if (!f || !f.visited) return <div className="empty mono">No visits in this range.</div>
  const steps = [
    ['visited', 'Visited the site'],
    ['product', 'Opened a product'],
    ['cart', 'Opened the cart'],
    ['checkout', 'Reached checkout'],
    ['ordered', 'Placed an order'],
  ]
  return (
    <div className="an-funnel">
      {steps.map(([k, label], i) => {
        const n = f[k] || 0
        const prevN = i ? f[steps[i - 1][0]] || 0 : n
        return (
          <div className="an-step" key={k}>
            <div className="an-bar-top">
              <span className="an-bar-name">{label}</span>
              <span className="an-bar-val mono">
                {n}
                <span className="dim"> · {pct(n, f.visited).toFixed(0)}% of visitors</span>
              </span>
            </div>
            <div className="an-bar-track"><i style={{ width: `${Math.max(1.5, pct(n, f.visited))}%` }} /></div>
            {i > 0 && prevN > 0 && (
              <div className="an-drop mono">{(100 - pct(n, prevN)).toFixed(0)}% didn't go on from the step before</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Pages({ data }) {
  const rows = useMemo(() => {
    const m = new Map()
    for (const r of data?.pages || []) {
      const t = pageType(r.path)
      const x = m.get(t) || { name: t, views: 0, entries: 0, bounces: 0 }
      x.views += r.views
      m.set(t, x)
    }
    for (const r of data?.entries || []) {
      const t = pageType(r.path)
      const x = m.get(t) || { name: t, views: 0, entries: 0, bounces: 0 }
      x.entries += r.entries
      x.bounces += r.bounces
      m.set(t, x)
    }
    return [...m.values()].sort((a, b) => b.views - a.views)
  }, [data])

  if (!rows.length) return <div className="empty mono">No visits in this range.</div>
  return (
    <div className="an-pages">
      <div className="an-pages-row head mono">
        <span>PAGE</span><span>VIEWS</span><span>VISITS STARTED HERE</span><span>LEFT AT ONCE</span>
      </div>
      {rows.map((r) => (
        <div className="an-pages-row mono" key={r.name}>
          <span className="an-pages-name">{r.name}</span>
          <span>{r.views}</span>
          <span>{r.entries}</span>
          <span>{r.entries ? `${pct(r.bounces, r.entries).toFixed(0)}%` : '—'}</span>
        </div>
      ))}
    </div>
  )
}
