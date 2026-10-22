import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'
import { orderMoney, phoneKey, unsold } from '../lib/admin.js'
import './investor-report.css'

const DAY = 86400e3

function taka(n) {
  return '৳ ' + Math.round(Number(n || 0)).toLocaleString()
}

function fmt(d, withYear = true) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}

function midnight(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// The business week here runs Saturday → Friday.
function weekStart(d) {
  const x = midnight(d)
  const back = (x.getDay() + 1) % 7 // Saturday = 0 days back
  x.setDate(x.getDate() - back)
  return x
}

function toInput(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// [start, end) for a period key, and the same length just before it.
function periodRange(key, from, to) {
  const now = new Date()
  let start
  let end
  if (key === 'this-week') {
    start = weekStart(now)
    end = new Date(start.getTime() + 7 * DAY)
  } else if (key === 'last-week') {
    end = weekStart(now)
    start = new Date(end.getTime() - 7 * DAY)
  } else if (key === 'this-month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  } else if (key === 'last-month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    end = new Date(now.getFullYear(), now.getMonth(), 1)
  } else {
    start = midnight(from ? new Date(from) : now)
    end = new Date(midnight(to ? new Date(to) : now).getTime() + DAY)
  }
  const len = end - start
  const monthly = key === 'this-month' || key === 'last-month'
  const prevStart = monthly ? new Date(start.getFullYear(), start.getMonth() - 1, 1) : new Date(start.getTime() - len)
  return { start, end, prevStart, prevEnd: start }
}

const PERIODS = [
  { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
]

// Everything the report says about one stretch of time.
function summarise(orders, start, end, firstSeen) {
  const at = (o) => new Date(o.created_at).getTime()
  const inRange = orders.filter((o) => at(o) >= start && at(o) < end)
  const live = inRange.filter((o) => !unsold(o))
  const sales = live.reduce((n, o) => n + Number(o.total ?? o.subtotal ?? 0), 0)
  const pieces = live.reduce((n, o) => n + (o.order_items || []).reduce((m, it) => m + Number(it.qty || 0), 0), 0)
  let revenue = 0
  let courier = 0
  let deliveredValue = 0
  let deliveredCourier = 0
  let returnLoss = 0
  let onTheWay = 0
  for (const o of inRange) {
    const m = orderMoney(o)
    revenue += m.toShop
    courier += m.courier
    if (o.status === 'delivered') {
      deliveredValue += Number(o.total ?? o.subtotal ?? 0)
      deliveredCourier += m.courier
    }
    if (o.status === 'returned' && m.toShop < 0) returnLoss -= m.toShop
    if (o.status === 'pending' || o.status === 'shipped') onTheWay += Number(o.total ?? o.subtotal ?? 0)
  }
  const status = { pending: 0, shipped: 0, delivered: 0, returned: 0, cancelled: 0 }
  for (const o of inRange) status[o.status] = (status[o.status] || 0) + 1

  const buyers = new Set()
  let fresh = 0
  for (const o of live) {
    const k = phoneKey(o.customer_phone)
    if (!k || buyers.has(k)) continue
    buyers.add(k)
    if ((firstSeen.get(k) ?? Infinity) >= start) fresh++
  }

  const settled = status.delivered + status.returned + status.cancelled
  return {
    orders: live.length,
    placed: inRange.length,
    sales,
    pieces,
    aov: live.length ? sales / live.length : 0,
    revenue,
    courier,
    deliveredValue,
    deliveredCourier,
    returnLoss,
    onTheWay,
    status,
    customers: buyers.size,
    fresh,
    repeat: buyers.size - fresh,
    // Of the orders that have settled, how many came back or were cancelled.
    lossRate: settled ? (status.returned + status.cancelled) / settled : 0,
    live,
    inRange,
  }
}

function change(now, before) {
  if (!before) return now ? 'new' : '—'
  const pct = ((now - before) / before) * 100
  if (Math.round(pct) === 0) return 'same'
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%`
}

function top(map, n = 6) {
  return [...map.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, n)
}

// Analytics → Investor report. Pick a week or a month; the page shows the
// report as it will print, and Download PDF opens the print dialog with
// only the report on the page — "Save as PDF" there makes the file. No
// customer names, phones or addresses are on it.
export default function InvestorReport({ orders }) {
  const [period, setPeriod] = useState('last-week')
  const [from, setFrom] = useState(() => toInput(new Date(Date.now() - 6 * DAY)))
  const [to, setTo] = useState(() => toInput(new Date()))
  const [note, setNote] = useState(() => {
    try { return localStorage.getItem('pause_report_note') || '' } catch { return '' }
  })
  const [withOrders, setWithOrders] = useState(false)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    try { localStorage.setItem('pause_report_note', note) } catch { /* not kept */ }
  }, [note])

  const range = useMemo(() => periodRange(period, from, to), [period, from, to])

  const data = useMemo(() => {
    // Each phone number's first order ever — to tell new customers from repeat.
    const firstSeen = new Map()
    for (const o of orders) {
      const k = phoneKey(o.customer_phone)
      const t = new Date(o.created_at).getTime()
      if (k && t < (firstSeen.get(k) ?? Infinity)) firstSeen.set(k, t)
    }
    const now = summarise(orders, range.start.getTime(), range.end.getTime(), firstSeen)
    const prev = summarise(orders, range.prevStart.getTime(), range.prevEnd.getTime(), firstSeen)

    // Sales per day.
    const days = []
    for (let t = range.start.getTime(); t < range.end.getTime(); t += DAY) {
      const d = new Date(t)
      const next = t + DAY
      const list = now.live.filter((o) => { const x = new Date(o.created_at).getTime(); return x >= t && x < next })
      days.push({ d, value: list.reduce((n, o) => n + Number(o.total ?? o.subtotal ?? 0), 0), count: list.length })
    }

    const products = new Map()
    const districts = new Map()
    const sources = new Map()
    for (const o of now.live) {
      for (const it of o.order_items || []) {
        const e = products.get(it.product_name) || { value: 0, pieces: 0 }
        e.value += Number(it.price) * Number(it.qty)
        e.pieces += Number(it.qty)
        products.set(it.product_name, e)
      }
      const dk = o.customer_area || 'Unknown'
      const de = districts.get(dk) || { value: 0, count: 0 }
      de.value += Number(o.total ?? o.subtotal ?? 0)
      de.count++
      districts.set(dk, de)
      const sk = o.utm_source || (o.id?.startsWith('PM') ? 'DM / by hand' : 'Direct')
      const se = sources.get(sk) || { value: 0, count: 0 }
      se.value += Number(o.total ?? o.subtotal ?? 0)
      se.count++
      sources.set(sk, se)
    }

    return { now, prev, days, products: top(products, 8), districts: top(districts), sources: top(sources) }
  }, [orders, range])

  // Print just the report: it's a direct child of <body> (portal), and the
  // html class hides everything else while printing.
  useEffect(() => {
    if (!printing) return
    const previous = document.title
    const label = `${fmt(range.start, false)}–${fmt(new Date(range.end - DAY))}`
    document.title = `PAUSE report · ${label}`
    document.documentElement.classList.add('printing-report')
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    // A frame for the portal to paint before the dialog freezes the page.
    const t = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      document.documentElement.classList.remove('printing-report')
      document.title = previous
    }
  }, [printing, range])

  const { now, prev, days } = data
  const maxDay = Math.max(1, ...days.map((d) => d.value))
  const periodLabel = PERIODS.find((p) => p.key === period)?.label
  const title = period.includes('month')
    ? `Monthly report · ${range.start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
    : `${period.includes('week') ? 'Weekly' : 'Sales'} report · ${fmt(range.start, false)} – ${fmt(new Date(range.end - DAY))}`

  const report = (
    <div className="ir-paper">
      <header className="ir-head">
        <div>
          <div className="ir-brand">PAUSE</div>
          <div className="ir-title">{title}</div>
        </div>
        <div className="ir-meta">
          <div>Prepared {fmt(new Date())}</div>
          <div>Compared with {fmt(range.prevStart, false)} – {fmt(new Date(range.prevEnd - DAY))}</div>
        </div>
      </header>

      {note.trim() && (
        <section className="ir-note">
          <div className="ir-label">HIGHLIGHTS</div>
          <p>{note.trim()}</p>
        </section>
      )}

      <section className="ir-kpis">
        {[
          ['Orders', now.orders, prev.orders, (v) => v],
          ['Sales', now.sales, prev.sales, taka],
          ['Revenue (after courier)', now.revenue, prev.revenue, taka],
          ['Average order', now.aov, prev.aov, taka],
          ['Pieces sold', now.pieces, prev.pieces, (v) => v],
          ['Customers', now.customers, prev.customers, (v) => v],
        ].map(([label, v, p, f]) => (
          <div className="ir-kpi" key={label}>
            <div className="ir-kpi-label">{label}</div>
            <div className="ir-kpi-value">{f(v)}</div>
            <div className={`ir-kpi-change ${v >= p ? 'up' : 'down'}`}>{change(v, p)} <span>vs {f(p)}</span></div>
          </div>
        ))}
      </section>

      <section className="ir-block">
        <div className="ir-label">SALES PER DAY</div>
        <div className="ir-bars" style={{ '--n': days.length }}>
          {days.map((d) => (
            <div className="ir-bar" key={d.d.getTime()} title={`${fmt(d.d, false)} · ${taka(d.value)} · ${d.count} orders`}>
              <span className="ir-bar-v">{d.value ? Math.round(d.value / 1000) + 'k' : ''}</span>
              <i style={{ height: `${(d.value / maxDay) * 100}%` }} />
              <span className="ir-bar-d">{days.length > 10 ? d.d.getDate() : d.d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="ir-cols">
        <section className="ir-block">
          <div className="ir-label">BEST SELLERS</div>
          {data.products.length === 0 ? <p className="ir-empty">No sales in this period.</p> : (
            <table className="ir-table">
              <thead><tr><th>Product</th><th>Pieces</th><th>Sales</th></tr></thead>
              <tbody>
                {data.products.map(([name, e]) => (
                  <tr key={name}><td>{name}</td><td>{e.pieces}</td><td>{taka(e.value)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="ir-block">
          <div className="ir-label">CUSTOMERS</div>
          <table className="ir-table">
            <tbody>
              <tr><td>New customers</td><td>{now.fresh}</td></tr>
              <tr><td>Came back to buy again</td><td>{now.repeat}</td></tr>
              <tr><td>Repeat share</td><td>{now.customers ? Math.round((now.repeat / now.customers) * 100) : 0}%</td></tr>
            </tbody>
          </table>
          <div className="ir-label ir-gap">ORDER STATUS</div>
          <table className="ir-table">
            <tbody>
              <tr><td>Delivered</td><td>{now.status.delivered}</td></tr>
              <tr><td>On the way / packing</td><td>{now.status.shipped + now.status.pending}</td></tr>
              <tr><td>Returned / cancelled</td><td>{now.status.returned + now.status.cancelled}</td></tr>
              <tr><td>Return &amp; cancel rate</td><td>{Math.round(now.lossRate * 100)}%</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <div className="ir-cols">
        <section className="ir-block">
          <div className="ir-label">WHERE ORDERS CAME FROM</div>
          {data.sources.length === 0 ? <p className="ir-empty">—</p> : (
            <table className="ir-table">
              <tbody>
                {data.sources.map(([k, e]) => (
                  <tr key={k}><td>{k}</td><td>{e.count}</td><td>{taka(e.value)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="ir-block">
          <div className="ir-label">TOP DISTRICTS</div>
          {data.districts.length === 0 ? <p className="ir-empty">—</p> : (
            <table className="ir-table">
              <tbody>
                {data.districts.map(([k, e]) => (
                  <tr key={k}><td>{k}</td><td>{e.count}</td><td>{taka(e.value)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="ir-block ir-money">
        <div className="ir-label">MONEY</div>
        <table className="ir-table">
          <tbody>
            <tr><td>Sales — every order placed (delivery included)</td><td>{taka(now.sales)}</td></tr>
            <tr className="ir-sub"><td>Still on the way or being packed</td><td>{taka(now.onTheWay)}</td></tr>
            <tr><td>Delivered and collected</td><td>{taka(now.deliveredValue)}</td></tr>
            <tr className="ir-sub"><td>Courier — delivery charge + 1% COD</td><td>− {taka(now.deliveredCourier)}</td></tr>
            {now.returnLoss > 0 && <tr className="ir-sub"><td>Returned parcels' unpaid delivery</td><td>− {taka(now.returnLoss)}</td></tr>}
            <tr><td><b>Revenue — reached the shop</b></td><td><b>{taka(now.revenue)}</b></td></tr>
          </tbody>
        </table>
        <p className="ir-fine">Revenue counts this period's delivered orders after the courier's cut. Orders still on the way add to it once they're delivered.</p>
      </section>

      {withOrders && (
        <section className="ir-block ir-orders">
          <div className="ir-label">ALL ORDERS · {now.inRange.length}</div>
          <table className="ir-table">
            <thead><tr><th>Order</th><th>Date</th><th>District</th><th>Pieces</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {[...now.inRange].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((o) => (
                <tr key={o.id}>
                  <td>{o.id}</td>
                  <td>{fmt(new Date(o.created_at), false)}</td>
                  <td>{o.customer_area}</td>
                  <td>{(o.order_items || []).reduce((n, it) => n + Number(it.qty || 0), 0)}</td>
                  <td>{taka(o.total ?? o.subtotal)}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="ir-foot">PAUSE · Dhaka · figures from the shop's own order records</footer>
    </div>
  )

  return (
    <div className="ir">
      <AdminBox
        wide
        title="INVESTOR REPORT"
        tip={
          <>
            <p>A clean report of one week or one month, to send to an investor as a PDF.</p>
            <p><b>How:</b> pick the period → write a few lines under Highlights (what went well, what's next) → <b>Download PDF</b> → in the print window choose <b>Save as PDF</b> → Save.</p>
            <p>Weeks run Saturday to Friday. Every number is compared with the period just before.</p>
            <p>No customer names, phone numbers or addresses go on the report.</p>
          </>
        }
      >
        <div className="ir-controls">
          <div className="chips mono">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" className={`chip ${period === p.key ? 'on' : ''}`} onClick={() => setPeriod(p.key)}>
                {p.label.toUpperCase()}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="ir-dates mono">
              <label>From <input type="date" className="ab-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>To <input type="date" className="ab-input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          )}
          <label className="ab-label mono">
            HIGHLIGHTS (OPTIONAL)
            <InfoTip>A few lines at the top of the report — e.g. "Drop 03 sold out in 2 days; next drop 15 Nov." Kept in this browser for next time.</InfoTip>
          </label>
          <textarea className="ab-input ir-note-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What went well this period, what's coming next…" />
          <label className="ab-switch mono">
            <input type="checkbox" checked={withOrders} onChange={(e) => setWithOrders(e.target.checked)} />
            Add the full order list (order number, date, district, total, status)
          </label>
          <div className="ir-go">
            <button type="button" className="ab-btn" onClick={() => setPrinting(true)}>Download PDF</button>
            <span className="mono dim">{periodLabel} · {now.placed} order{now.placed === 1 ? '' : 's'}</span>
          </div>
        </div>
      </AdminBox>

      <div className="ir-preview-label mono">PREVIEW</div>
      <div className="ir-preview">{report}</div>

      {printing && createPortal(<div className="ir-print">{report}</div>, document.body)}
    </div>
  )
}
