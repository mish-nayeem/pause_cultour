import { useEffect, useMemo, useRef, useState } from 'react'
import InfoTip from './InfoTip.jsx'
import { orderMoney, phoneKey, unsold } from '../lib/admin.js'
import { listDrops } from '../lib/dropMoney.js'
import { DAY, PRESETS, rangeFor, bucketsFor, bucketLabel, toInput } from '../lib/periods.js'
import './overview-charts.css'

function taka(n) {
  const v = Math.round(Number(n || 0))
  return (v < 0 ? '− ' : '') + '৳ ' + Math.abs(v).toLocaleString()
}

function short(n) {
  const v = Math.abs(n)
  if (v >= 100000) return `${+(n / 100000).toFixed(1)}L`
  if (v >= 1000) return `${(n / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return String(Math.round(n))
}

const at = (o) => new Date(o.created_at).getTime()
const value = (o) => Number(o.total ?? o.subtotal ?? 0)
const pieces = (o) => (o.order_items || []).reduce((n, it) => n + Number(it.qty || 0), 0)

// The width a chart has to draw in, kept up to date.
function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// The date range both views pick from: presets, or Custom with two dates.
function useRange(initial, orders) {
  const [preset, setPreset] = useState(initial)
  const [from, setFrom] = useState(() => toInput(new Date(Date.now() - 29 * DAY)))
  const [to, setTo] = useState(() => toInput(new Date()))
  const firstOrderAt = useMemo(() => orders.reduce((m, o) => Math.min(m, at(o)), Date.now()), [orders])
  const range = useMemo(() => rangeFor(preset, { from, to, firstOrderAt }), [preset, from, to, firstOrderAt])
  return { preset, setPreset, from, setFrom, to, setTo, range }
}

function RangeBar({ r, note }) {
  return (
    <div className="ovc-range">
      <div className="chips mono" role="radiogroup" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={r.preset === p.key} className={`chip ${r.preset === p.key ? 'on' : ''}`} onClick={() => r.setPreset(p.key)}>
            {p.label.toUpperCase()}
          </button>
        ))}
      </div>
      {r.preset === 'custom' && (
        <div className="ovc-dates mono">
          <label>From <input type="date" className="ab-input" value={r.from} onChange={(e) => r.setFrom(e.target.value)} /></label>
          <label>To <input type="date" className="ab-input" value={r.to} onChange={(e) => r.setTo(e.target.value)} /></label>
        </div>
      )}
      {note && <div className="ovc-range-note mono">{note}</div>}
    </div>
  )
}

function rangeText({ start, end }) {
  const a = new Date(start)
  const b = new Date(end - 1)
  const f = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return a.toDateString() === b.toDateString() ? f(a) : `${f(a)} – ${f(b)}`
}

// Everything the cards say about one stretch of time.
function summarise(orders, start, end, firstSeen) {
  const inRange = orders.filter((o) => at(o) >= start && at(o) < end)
  const live = inRange.filter((o) => !unsold(o))
  let revenue = 0
  let toCollect = 0
  for (const o of inRange) {
    const m = orderMoney(o)
    revenue += m.toShop
    if (m.expected) toCollect += m.receivable
  }
  const buyers = new Set()
  let fresh = 0
  for (const o of live) {
    const k = phoneKey(o.customer_phone)
    if (!k || buyers.has(k)) continue
    buyers.add(k)
    if ((firstSeen.get(k) ?? Infinity) >= start) fresh++
  }
  const status = { pending: 0, shipped: 0, delivered: 0, returned: 0, cancelled: 0 }
  for (const o of inRange) status[o.status] = (status[o.status] || 0) + 1
  const settled = status.delivered + status.returned + status.cancelled
  const sales = live.reduce((n, o) => n + value(o), 0)
  return {
    orders: live.length,
    sales,
    revenue,
    toCollect,
    pieces: live.reduce((n, o) => n + pieces(o), 0),
    aov: live.length ? sales / live.length : 0,
    customers: buyers.size,
    fresh,
    lossRate: settled ? (status.returned + status.cancelled) / settled : 0,
    status,
    live,
  }
}

function firstSeenMap(orders) {
  const m = new Map()
  for (const o of orders) {
    const k = phoneKey(o.customer_phone)
    if (k && at(o) < (m.get(k) ?? Infinity)) m.set(k, at(o))
  }
  return m
}

function change(now, before, lowerIsBetter = false) {
  if (!before) return { text: now ? 'new' : '—', good: true }
  const pct = ((now - before) / before) * 100
  if (Math.abs(pct) < 0.5) return { text: 'same', good: true }
  const up = pct > 0
  return { text: `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%`, good: lowerIsBetter ? !up : up }
}

// A tiny line of the metric across the range, inside a card.
function Spark({ values }) {
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const w = 120
  const h = 28
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(' ')
  return (
    <svg className="ovc-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const STATUS_ORDER = [
  ['pending', 'Pending'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['returned', 'Returned'],
  ['cancelled', 'Cancelled'],
]

// ======================= Overview → Key stats =======================

export function KeyStats({ orders, onOpenOrders }) {
  const r = useRange('30d', orders)
  const { range } = r
  const firstSeen = useMemo(() => firstSeenMap(orders), [orders])
  const now = useMemo(() => summarise(orders, range.start, range.end, firstSeen), [orders, range, firstSeen])
  const prev = useMemo(() => summarise(orders, range.prevStart, range.prevEnd, firstSeen), [orders, range, firstSeen])

  // Per-bucket values for each card's little line.
  const sparks = useMemo(() => {
    const { buckets } = bucketsFor(range.start, range.end)
    const per = buckets.map((b) => orders.filter((o) => at(o) >= b.start && at(o) < b.end))
    return {
      orders: per.map((l) => l.filter((o) => !unsold(o)).length),
      sales: per.map((l) => l.filter((o) => !unsold(o)).reduce((n, o) => n + value(o), 0)),
      revenue: per.map((l) => l.reduce((n, o) => n + orderMoney(o).toShop, 0)),
      pieces: per.map((l) => l.filter((o) => !unsold(o)).reduce((n, o) => n + pieces(o), 0)),
    }
  }, [orders, range])

  // Best sellers in the range.
  const best = useMemo(() => {
    const m = new Map()
    for (const o of now.live) for (const it of o.order_items || []) {
      const e = m.get(it.product_name) || { pieces: 0, value: 0 }
      e.pieces += Number(it.qty)
      e.value += Number(it.price) * Number(it.qty)
      m.set(it.product_name, e)
    }
    return [...m.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 5)
  }, [now])
  const bestMax = Math.max(1, ...best.map(([, e]) => e.value))

  const cards = [
    { key: 'orders', label: 'ORDERS', v: now.orders, p: prev.orders, f: (x) => x, spark: sparks.orders, tip: 'Orders placed in this range, cancelled and returned ones left out.', open: () => onOpenOrders('all') },
    { key: 'sales', label: 'SALES', v: now.sales, p: prev.sales, f: taka, spark: sparks.sales, tip: 'What those orders add up to, delivery included, less coupons and refunds. Counted when placed.' },
    { key: 'revenue', label: 'REVENUE', v: now.revenue, p: prev.revenue, f: taka, spark: sparks.revenue, tip: "What reached you from this range's orders that are delivered: products less the courier's 1%, less unpaid return / 2nd-parcel charges. Delivery charges go to the courier." },
    { key: 'collect', label: 'STILL TO COLLECT', v: now.toCollect, p: prev.toCollect, f: taka, tip: "This range's orders still pending or on the way — what they'll bring in after the courier's 1%, once delivered.", open: () => onOpenOrders('shipped'), neutral: true },
    { key: 'aov', label: 'AVERAGE ORDER', v: now.aov, p: prev.aov, f: taka, tip: 'Sales ÷ orders.' },
    { key: 'pieces', label: 'PIECES SOLD', v: now.pieces, p: prev.pieces, f: (x) => x, spark: sparks.pieces, tip: 'Pieces in those orders.' },
    { key: 'customers', label: 'CUSTOMERS', v: now.customers, p: prev.customers, f: (x) => x, sub: `${now.fresh} new · ${now.customers - now.fresh} came back`, tip: 'Different phone numbers that ordered. New = their first order ever is in this range.' },
    { key: 'loss', label: 'RETURN & CANCEL RATE', v: now.lossRate, p: prev.lossRate, f: (x) => `${Math.round(x * 100)}%`, lower: true, tip: 'Of the orders that have settled (delivered, returned or cancelled), the share that came back or was cancelled. Lower is better.' },
  ]

  const total = STATUS_ORDER.reduce((n, [k]) => n + now.status[k], 0)

  return (
    <div className="ovc">
      <RangeBar r={r} note={`${rangeText(range)} · compared with the ${r.preset === 'month' || r.preset === 'last-month' ? 'month' : 'same length'} just before`} />

      <div className="ovc-cards">
        {cards.map((c) => {
          const ch = change(c.v, c.p, c.lower)
          const Tag = c.open ? 'button' : 'div'
          return (
            <Tag key={c.key} type={c.open ? 'button' : undefined} className={`ovc-card ${c.open ? 'click' : ''}`} onClick={c.open}>
              <span className="ovc-card-label mono">
                {c.label}
                <span onClick={(e) => e.stopPropagation()}><InfoTip>{c.tip}</InfoTip></span>
              </span>
              <strong>{c.f(c.v)}</strong>
              <span className="ovc-card-foot mono">
                {!c.neutral && <em className={ch.good ? 'up' : 'down'}>{ch.text}</em>}
                <span>{c.sub || `vs ${c.f(c.p)}`}</span>
              </span>
              {c.spark && <Spark values={c.spark} />}
            </Tag>
          )
        })}
      </div>

      <div className="ovc-two">
        <section className="ovc-box">
          <div className="ovc-box-head mono">
            ORDER STATUS
            <InfoTip>Where this range's orders are now. Tap a part to open those orders.</InfoTip>
          </div>
          {total === 0 ? (
            <div className="ab-empty mono">No orders in this range.</div>
          ) : (
            <>
              <div className="ovc-pipe" role="img" aria-label="Orders by status">
                {STATUS_ORDER.filter(([k]) => now.status[k]).map(([k, label]) => (
                  <button key={k} type="button" className={`ovc-pipe-seg ${k}`} style={{ flexGrow: now.status[k] }} title={`${label}: ${now.status[k]}`} onClick={() => onOpenOrders(k)} />
                ))}
              </div>
              <div className="ovc-pipe-legend mono">
                {STATUS_ORDER.map(([k, label]) => (
                  <button key={k} type="button" onClick={() => onOpenOrders(k)}>
                    <i className={`ovc-dot ${k}`} />
                    {label} <b>{now.status[k]}</b>
                    <span>{total ? Math.round((now.status[k] / total) * 100) : 0}%</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="ovc-box">
          <div className="ovc-box-head mono">
            BEST SELLERS
            <InfoTip>The pieces that brought in the most in this range.</InfoTip>
          </div>
          {best.length === 0 ? (
            <div className="ab-empty mono">No sales in this range.</div>
          ) : (
            <div className="ovc-rank">
              {best.map(([name, e]) => (
                <div className="ovc-rank-row" key={name} title={`${name} · ${e.pieces} pcs · ${taka(e.value)}`}>
                  <span className="ovc-rank-name">{name}</span>
                  <span className="ovc-rank-bar"><i style={{ width: `${(e.value / bestMax) * 100}%` }} /></span>
                  <span className="ovc-rank-v mono">{taka(e.value)} · {e.pieces}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ======================= Overview → Sales trend =======================

const METRICS = [
  { key: 'sales', label: 'Sales', f: taka, of: (list) => list.filter((o) => !unsold(o)).reduce((n, o) => n + value(o), 0) },
  { key: 'revenue', label: 'Revenue', f: taka, of: (list) => list.reduce((n, o) => n + orderMoney(o).toShop, 0) },
  { key: 'orders', label: 'Orders', f: (x) => String(x), of: (list) => list.filter((o) => !unsold(o)).length },
  { key: 'pieces', label: 'Pieces', f: (x) => `${x} pcs`, of: (list) => list.filter((o) => !unsold(o)).reduce((n, o) => n + pieces(o), 0) },
]

// The line: this range filled, the range before it dashed behind, a
// crosshair and a tooltip under the pointer.
function TrendChart({ points, unit, format, prevLabel }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const h = 240
  const pad = { l: 46, r: 12, t: 14, b: 26 }
  const iw = w - pad.l - pad.r
  const ih = h - pad.t - pad.b
  const max = Math.max(1, ...points.map((p) => Math.max(p.value, p.prev ?? 0)))
  const nice = niceMax(max)
  const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const y = (v) => pad.t + ih - (v / nice) * ih
  const line = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key] ?? 0)}`).join(' ')
  const area = `${line('value')} L${x(points.length - 1)},${pad.t + ih} L${x(0)},${pad.t + ih} Z`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * nice)
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 70))))

  function move(e) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left
    const i = Math.round(((px - pad.l) / iw) * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, i)))
  }

  const hp = hover != null ? points[hover] : null
  return (
    <div className="ovc-chart" ref={ref}>
      <svg width={w} height={h} onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Trend chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="ovc-grid" />
            <text x={pad.l - 8} y={y(t)} className="ovc-axis" textAnchor="end" dominantBaseline="middle">{short(t)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % every === 0 || (i === points.length - 1 && i % every >= every / 2)) && (
          <text key={i} x={x(i)} y={h - 8} className="ovc-axis" textAnchor="middle">{p.label}</text>
        ))}
        {points.some((p) => p.prev != null) && <path d={line('prev')} className="ovc-prev" />}
        <path d={area} className="ovc-area" />
        <path d={line('value')} className="ovc-line" />
        {hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="ovc-cross" />
            <circle cx={x(hover)} cy={y(hp.value)} r="5" className="ovc-mark" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="ovc-tip mono" style={{ left: Math.min(Math.max(x(hover), 90), w - 90) }}>
          <b>{hp.long}</b>
          <span>{format(hp.value)}</span>
          {hp.prev != null && <span className="dim">{prevLabel}: {format(hp.prev)}</span>}
        </div>
      )}
      <div className="ovc-legend mono">
        <span><i className="ovc-key-line" /> This range ({unit}s)</span>
        <span><i className="ovc-key-prev" /> {prevLabel}</span>
      </div>
    </div>
  )
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  // Tops that split into four round steps: 4 → 1, 8 → 2, 20 → 5…
  for (const m of [1, 2, 4, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

// Each drop's sales, day by day from its launch, added up — so drops can be
// compared at the same age: "Day 7: CITYBOY ৳48k, OCTOBER ৳31k".
function DropRace({ orders, products }) {
  const [days, setDays] = useState(14)
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const drops = useMemo(() => listDrops(products).filter((d) => Number.isFinite(d.start)).slice(0, 5), [products])

  const lines = useMemo(() => drops.map((d, k) => {
    const daily = Array(days).fill(0)
    let pcs = 0
    for (const o of orders) {
      if (unsold(o)) continue
      const mine = (o.order_items || []).filter((it) => d.ids.has(String(it.product_id)))
      if (!mine.length) continue
      const i = Math.max(0, Math.floor((at(o) - d.start) / DAY)) // early access counts as day 1
      if (i >= days) continue
      const all = (o.order_items || []).reduce((n, it) => n + Number(it.price) * Number(it.qty), 0) || 1
      const mineV = mine.reduce((n, it) => n + Number(it.price) * Number(it.qty), 0)
      daily[i] += mineV - (Number(o.discount_amount) || 0) * (mineV / all)
      pcs += mine.reduce((n, it) => n + Number(it.qty), 0)
    }
    let run = 0
    const cum = daily.map((v) => (run += v))
    // A drop younger than the window stops at today.
    const age = Math.min(days, Math.floor((Date.now() - d.start) / DAY) + 1)
    return { name: d.name, slot: k + 1, cum: cum.slice(0, Math.max(1, age)), total: run, pcs, launched: d.start }
  }), [drops, orders, days])

  const h = 260
  const pad = { l: 46, r: 92, t: 14, b: 26 }
  const iw = w - pad.l - pad.r
  const ih = h - pad.t - pad.b
  const nice = niceMax(Math.max(1, ...lines.flatMap((l) => l.cum)))
  const x = (i) => pad.l + (days === 1 ? 0 : (i / (days - 1)) * iw)
  const y = (v) => pad.t + ih - (v / nice) * ih
  const every = Math.max(1, Math.ceil(days / Math.max(2, Math.floor(iw / 60))))

  function move(e) {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - box.left - pad.l) / iw) * (days - 1))
    setHover(Math.max(0, Math.min(days - 1, i)))
  }

  if (!drops.length) return <div className="ab-empty mono">No drops with a launch date yet.</div>

  return (
    <div>
      <div className="chips mono ovc-race-days">
        {[7, 14, 30, 60].map((n) => (
          <button key={n} type="button" className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>FIRST {n} DAYS</button>
        ))}
      </div>
      <div className="ovc-chart" ref={ref}>
        <svg width={w} height={h} onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Sales by drop since launch">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t * nice)} y2={y(t * nice)} className="ovc-grid" />
              <text x={pad.l - 8} y={y(t * nice)} className="ovc-axis" textAnchor="end" dominantBaseline="middle">{short(t * nice)}</text>
            </g>
          ))}
          {Array.from({ length: days }, (_, i) => (i % every === 0 || (i === days - 1 && i % every >= every / 2)) && (
            <text key={i} x={x(i)} y={h - 8} className="ovc-axis" textAnchor="middle">Day {i + 1}</text>
          ))}
          {lines.map((l) => (
            <g key={l.name} className={`ovc-s${l.slot}`}>
              <path d={l.cum.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')} className="ovc-sline" />
              <circle cx={x(l.cum.length - 1)} cy={y(l.cum[l.cum.length - 1])} r="4" className="ovc-send" />
              <text x={x(l.cum.length - 1) + 8} y={y(l.cum[l.cum.length - 1])} className="ovc-slabel" dominantBaseline="middle">{l.name}</text>
            </g>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="ovc-cross" />}
        </svg>
        {hover != null && (
          <div className="ovc-tip mono" style={{ left: Math.min(Math.max(x(hover), 100), w - 100) }}>
            <b>Day {hover + 1} since launch</b>
            {lines.map((l) => (
              <span key={l.name}><i className={`ovc-dot ovc-s${l.slot}`} /> {l.name}: {l.cum[hover] != null ? taka(l.cum[hover]) : 'not yet'}</span>
            ))}
          </div>
        )}
        <div className="ovc-legend mono">
          {lines.map((l) => <span key={l.name}><i className={`ovc-dot ovc-s${l.slot}`} /> {l.name}</span>)}
        </div>
      </div>
      <table className="ovc-table mono">
        <thead><tr><th>Drop</th><th>Launched</th><th>Sales · {days}d</th><th>Pcs</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.name}>
              <td><i className={`ovc-dot ovc-s${l.slot}`} /> {l.name}</td>
              <td>{new Date(l.launched).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
              <td>{taka(l.total)}</td>
              <td>{l.pcs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Which days of the week sell — over the range.
function Weekdays({ orders, range }) {
  const names = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const vals = Array(7).fill(0)
  const counts = Array(7).fill(0)
  for (const o of orders) {
    if (unsold(o) || at(o) < range.start || at(o) >= range.end) continue
    const i = (new Date(o.created_at).getDay() + 1) % 7
    vals[i] += value(o)
    counts[i]++
  }
  const max = Math.max(1, ...vals)
  return (
    <div className="ovc-week">
      {names.map((n, i) => (
        <div className="ovc-week-col" key={n} title={`${n}: ${taka(vals[i])} · ${counts[i]} orders`}>
          <span className="ovc-week-v mono">{vals[i] ? short(vals[i]) : ''}</span>
          <span className="ovc-week-bar"><i style={{ height: `${(vals[i] / max) * 100}%` }} /></span>
          <span className="ovc-week-n mono">{n}</span>
        </div>
      ))}
    </div>
  )
}

export function SalesTrend({ orders, products }) {
  const r = useRange('30d', orders)
  const { range } = r
  const [metric, setMetric] = useState('sales')
  const M = METRICS.find((m) => m.key === metric)

  const { unit, points, total, prevTotal } = useMemo(() => {
    const { unit, buckets } = bucketsFor(range.start, range.end)
    const shift = range.start - range.prevStart
    const pts = buckets.map((b) => {
      const list = orders.filter((o) => at(o) >= b.start && at(o) < b.end)
      const before = orders.filter((o) => at(o) >= b.start - shift && at(o) < b.end - shift && at(o) >= range.prevStart)
      return { label: bucketLabel(b.start, unit), long: bucketLabel(b.start, unit, true), value: M.of(list), prev: M.of(before) }
    })
    return {
      unit,
      points: pts,
      total: M.of(orders.filter((o) => at(o) >= range.start && at(o) < range.end)),
      prevTotal: M.of(orders.filter((o) => at(o) >= range.prevStart && at(o) < range.prevEnd)),
    }
  }, [orders, range, M])

  const ch = change(total, prevTotal)

  return (
    <div className="ovc">
      <RangeBar r={r} note={rangeText(range)} />

      <section className="ovc-box">
        <div className="ovc-box-top">
          <div>
            <div className="ovc-box-head mono">
              {M.label.toUpperCase()} OVER TIME
              <InfoTip>
                <p>The solid line is this range, by {unit}; the dashed one is the range just before it, lined up, so you see whether you're ahead.</p>
                <p><b>Sales</b> = orders placed (delivery included). <b>Revenue</b> = what reached you from delivered orders, after the courier. Hover for each {unit}'s figures.</p>
              </InfoTip>
            </div>
            <div className="ovc-hero">
              <strong>{M.f(total)}</strong>
              <em className={ch.good ? 'up' : 'down'}>{ch.text}</em>
              <span className="mono">vs {M.f(prevTotal)} before</span>
            </div>
          </div>
          <div className="toggle mono">
            {METRICS.map((m) => (
              <button key={m.key} type="button" className={metric === m.key ? 'on' : ''} onClick={() => setMetric(m.key)}>{m.label.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <TrendChart points={points} unit={unit} format={M.f} prevLabel="Range before" />
      </section>

      <section className="ovc-box">
        <div className="ovc-box-head mono">
          DROPS SINCE LAUNCH
          <InfoTip>
            <p>Each drop's sales added up day by day from its launch — so a new drop can be compared with the last ones at the same age.</p>
            <p>Early-access sales count on day 1. A drop younger than the window stops at today. The five newest drops are shown.</p>
          </InfoTip>
        </div>
        <DropRace orders={orders} products={products} />
      </section>

      <section className="ovc-box">
        <div className="ovc-box-head mono">
          BEST DAYS OF THE WEEK
          <InfoTip>Sales by weekday over the range above — when to post, run ads or launch.</InfoTip>
        </div>
        <Weekdays orders={orders} range={range} />
      </section>
    </div>
  )
}
