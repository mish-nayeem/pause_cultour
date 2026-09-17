import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLogin from './AdminLogin.jsx'
import {
  getSession,
  signOut,
  fetchOrders,
  fetchAdminProducts,
  updateOrderStatus,
  computeStats,
  dailySeries,
  monthlySeries,
  salesByDrop,
  salesByCategory,
  topProducts,
  lowStockSizes,
  customerIndex,
  lookupCustomer,
} from '../lib/admin.js'
import { sendStatusUpdate, sendRestockAlert } from '../lib/email.js'
import { cld } from '../lib/cloudinary.js'
import ProductForm from '../components/ProductForm.jsx'
import HeroManager from '../components/HeroManager.jsx'
import CategoryManager from '../components/CategoryManager.jsx'
import AboutManager from '../components/AboutManager.jsx'
import { fetchAllNavCategories } from '../lib/navCategories.js'
import { stockMap, totalStock, LOW_STOCK_AT } from '../lib/stock.js'
import { fetchWishlist, groupDemand } from '../lib/wishlist.js'
import { COURIERS, courierLabel, sendToCourier, syncCourierStatus } from '../lib/courier.js'
import {
  IconGrid,
  IconBag,
  IconTag,
  IconBox,
  IconTruck,
  IconCheck,
  IconX,
  IconCash,
  IconSearch,
  IconChevron,
  IconExternal,
  IconLogout,
  IconTrend,
  IconStar,
  IconClock,
  IconImage,
  IconList,
} from '../components/Icons.jsx'
import './admin.css'

const STATUSES = ['pending', 'shipped', 'delivered', 'cancelled']

function taka(n) {
  return '৳ ' + Number(n).toLocaleString()
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

// Inline sparkline — avoids pulling in a charting library for one graph.
function Sparkline({ series }) {
  const w = 620
  const h = 150
  const pad = 6
  const max = Math.max(1, ...series.map((d) => d.value))

  const pts = series.map((d, i) => {
    const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2)
    const y = h - pad - (d.value / max) * (h - pad * 2)
    return [x, y]
  })

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L ${pts[0][0].toFixed(1)} ${h - pad} Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
      <path d={area} fill="var(--cobalt)" fillOpacity="0.08" />
      <path d={line} fill="none" stroke="var(--cobalt)" strokeWidth="1.8" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.2" fill="var(--cobalt)" />
      ))}
    </svg>
  )
}

// Vertical bars, one measure at a time — the toggle swaps which measure is
// drawn rather than adding a second axis, so the heights stay comparable.
function MonthBars({ series, metric, format }) {
  const max = Math.max(1, ...series.map((d) => d[metric]))

  return (
    <div className="bars">
      <div className="bars-max mono">{format(max)}</div>
      <div className="bars-plot">
        {series.map((d) => {
          const value = d[metric]
          // A month that sold something keeps a visible stub even when it is
          // dwarfed by the best month; a month with nothing stays empty.
          const height = value > 0 ? Math.max(2, (value / max) * 100) : 0

          return (
            <div className="bar-col" key={d.key}>
              <div className="bar-track">
                {/* The read-out hangs off the top of the bar itself, so it
                    always points at the value it belongs to. */}
                <div className="bar-fill" style={{ height: `${height}%` }}>
                  <div className="bar-tip mono">
                    {d.label} {d.year} · {format(value)}
                    <span className="dim"> · {d.orders} order{d.orders === 1 ? '' : 's'}</span>
                  </div>
                </div>
              </div>
              <div className="bar-x mono">{d.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Horizontal bars for named buckets (drops, categories) — those labels are
// words, not dates, so each gets its own line instead of a cramped column head.
function RankBars({ rows, empty, accent }) {
  if (rows.length === 0) return <div className="empty mono">{empty}</div>

  const max = Math.max(1, ...rows.map((r) => r.units))

  return (
    <div className={`hbars ${accent || ''}`}>
      {rows.map((r) => (
        <div className="hbar" key={r.name}>
          <div className="hbar-top">
            <span className="hbar-name">{r.name}</span>
            <span className="hbar-val mono">
              {r.units} pcs<span className="dim"> · {taka(r.value)}</span>
            </span>
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${Math.max(2, (r.units / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// A headline number that doubles as the way into the list it counts.
function StatCard({ icon, tone, label, value, note, onClick, cta }) {
  const body = (
    <>
      <div className="stat-top">
        <span className={`stat-ico ${tone || ''}`}>{icon}</span>
        <div className="stat-label mono">{label}</div>
      </div>
      <div className="stat-value display">{value}</div>
      {note && <div className="stat-note mono">{note}</div>}
      {onClick && <div className="stat-cta mono">{cta || 'View list'} →</div>}
    </>
  )

  if (!onClick) return <div className="stat">{body}</div>

  return (
    <button type="button" className="stat stat-click" onClick={onClick}>
      {body}
    </button>
  )
}

// What goes in the bag with the parcel. Hidden on screen and the only thing
// on the page when it prints, so no stylesheet juggling and no popup window
// for the browser to block.
function PackingSlip({ order }) {
  const items = order.order_items || []
  const total = Number(order.total ?? order.subtotal)
  const advance = Number(order.advance_amount) || 0
  const due = total - advance

  return (
    <div className="slip-root">
      <div className="slip">
        <div className="slip-head">
          <div>
            <div className="display slip-brand">PAUSE</div>
            <div className="mono slip-sub">CASH ON DELIVERY</div>
          </div>
          <div className="slip-id mono">
            <div className="slip-id-big">{order.id}</div>
            <div>{new Date(order.created_at).toLocaleDateString('en-GB')}</div>
          </div>
        </div>

        <div className="slip-to">
          <div className="mono slip-label">DELIVER TO</div>
          <div className="slip-name">{order.customer_name}</div>
          <div className="slip-phone mono">{order.customer_phone}</div>
          <div className="slip-addr">{order.customer_address}</div>
          <div className="slip-addr">{order.customer_area}</div>
          {order.customer_note && <div className="slip-note">Note: {order.customer_note}</div>}
        </div>

        <table className="slip-items">
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.product_name} · {it.size} × {it.qty}</td>
                <td className="mono right">{taka(it.price * it.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="slip-money mono">
          <tbody>
            <tr><td>Items</td><td className="right">{taka(order.subtotal)}</td></tr>
            {order.delivery_zone && (
              <tr>
                <td>Delivery · {order.delivery_zone === 'inside' ? 'Inside' : 'Outside'} Dhaka</td>
                <td className="right">{taka(order.delivery_fee ?? 0)}</td>
              </tr>
            )}
            {advance > 0 && (
              <tr>
                <td>Advance paid · bKash {order.advance_trx_id || ''}</td>
                <td className="right">− {taka(advance)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* The one number the rider needs, big enough to read at the door. */}
        <div className="slip-due">
          <span className="mono">COLLECT</span>
          <span className="display slip-due-amount">{taka(due)}</span>
        </div>

        <div className="slip-foot mono">
          Check the parcel in front of the rider · pause.bd@gmail.com
        </div>
      </div>
    </div>
  )
}

export default function Admin() {
  const [session, setSession] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  const [tab, setTab] = useState('overview')
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [navCategories, setNavCategories] = useState([])
  const [wishRows, setWishRows] = useState([])
  const [notifying, setNotifying] = useState(null)
  const [courierBusy, setCourierBusy] = useState(null)
  const [courierPick, setCourierPick] = useState({})
  const [slipOrder, setSlipOrder] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [monthMetric, setMonthMetric] = useState('units')
  const [editing, setEditing] = useState(null) // null | 'new' | product row

  useEffect(() => {
    getSession().then((s) => {
      setSession(s)
      setCheckingAuth(false)
    })
  }, [])

  // Pulled out of the effect so the product form can refresh the list after a
  // save or delete without duplicating the fetch logic.
  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError('')

    const [o, p, c, w] = await Promise.all([
      fetchOrders(),
      fetchAdminProducts(),
      fetchAllNavCategories(),
      fetchWishlist(),
    ])

    if (o.error) {
      setLoadError(
        "Couldn't load orders. Make sure you ran the admin SQL policies in Supabase."
      )
    }

    setOrders(o.orders)
    setProducts(p.products)
    setNavCategories(c.categories)
    setWishRows(w.rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!session) return
    reload()
  }, [session, reload])

  const stats = useMemo(() => computeStats(orders), [orders])
  const series = useMemo(() => dailySeries(orders, 14), [orders])
  const months = useMemo(() => monthlySeries(orders, 6), [orders])
  const byDrop = useMemo(() => salesByDrop(orders, products), [orders, products])
  const byCategory = useMemo(() => salesByCategory(orders, products), [orders, products])
  const top = useMemo(() => topProducts(orders, 5), [orders])
  const lowStock = useMemo(() => lowStockSizes(products), [products])
  const demand = useMemo(() => groupDemand(wishRows), [wishRows])
  const customers = useMemo(() => customerIndex(orders), [orders])

  // The names already in use plus the ones on the shop menu, so a product can
  // be filed under a menu category that has nothing in it yet — the spellings
  // have to match exactly for the menu to find the product.
  const productCategories = useMemo(
    () =>
      [
        ...new Set([
          ...products.map((p) => p.category),
          ...navCategories.map((c) => c.label),
        ].filter(Boolean)),
      ].sort(),
    [products, navCategories]
  )

  const filteredOrders = useMemo(() => {
    const byStatus =
      statusFilter === 'all' ? orders : orders.filter((o) => o.status === statusFilter)

    if (!search.trim()) return byStatus

    const q = search.trim().toLowerCase()
    return byStatus.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.includes(q)
    )
  }, [orders, search, statusFilter])

  // Every counter on the overview is a way into the orders behind it — the
  // click lands on the orders tab with that status already filtered.
  function openOrders(status) {
    setStatusFilter(status)
    setSearch('')
    setExpanded(null)
    setTab('orders')
  }

  async function handleStatusChange(orderId, status) {
    setSavingId(orderId)
    const { error } = await updateOrderStatus(orderId, status)

    if (error) {
      setSavingId(null)
      setLoadError("Couldn't update that order's status. Try again.")
      return
    }

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)))

    // Emails the customer if the new status is one worth telling them about.
    // The status change is already saved, so a mail failure is logged and
    // otherwise ignored rather than shown as a failed update.
    await sendStatusUpdate(orderId, status)

    setSavingId(null)
  }

  // Rendered, printed, then dropped once the dialog closes. Waiting for
  // afterprint rather than clearing straight away keeps the slip on the page
  // for the browsers that print asynchronously.
  useEffect(() => {
    if (!slipOrder) return

    // Chrome names a "Save as PDF" file after the document title, so the slip
    // saves as PC481203.pdf rather than whatever the admin tab was called.
    const previousTitle = document.title
    document.title = `${slipOrder.id} · PAUSE packing slip`

    const done = () => setSlipOrder(null)
    window.addEventListener('afterprint', done)
    window.print()

    return () => {
      window.removeEventListener('afterprint', done)
      document.title = previousTitle
    }
  }, [slipOrder])

  async function handleCourierSend(order) {
    const courier = courierPick[order.id] || COURIERS[0].key

    setCourierBusy(order.id)
    setLoadError('')

    const { error } = await sendToCourier(order.id, courier)

    setCourierBusy(null)
    if (error) setLoadError(error)
    else reload()
  }

  async function handleCourierSync(order) {
    setCourierBusy(order.id)
    setLoadError('')

    const { error } = await syncCourierStatus(order.id)

    setCourierBusy(null)
    if (error) setLoadError(error)
    else reload()
  }

  // The mail itself is sent by the edge function, which reads the addresses
  // and marks them notified — no customer email passes through this page.
  async function handleNotify(group) {
    setNotifying(group.key)
    const result = await sendRestockAlert(group.productId, group.size || null)

    if (result?.error) {
      setLoadError(
        "Couldn't send that restock email. The send-restock-alert function may " +
        'not be deployed yet — the list is still saved.'
      )
    }

    setNotifying(null)
    reload()
  }

  async function handleSignOut() {
    await signOut()
    setSession(null)
    setOrders([])
    setProducts([])
  }

  if (checkingAuth) {
    return <div className="admin-boot mono">Checking access…</div>
  }

  if (!session) {
    return <AdminLogin onSignedIn={setSession} />
  }

  const windowValue = series.reduce((s, d) => s + d.value, 0)
  const windowOrders = series.reduce((s, d) => s + d.orders, 0)

  const statusCounts = {
    all: orders.length,
    pending: stats.pending,
    shipped: stats.shipped,
    delivered: stats.delivered,
    cancelled: stats.cancelled,
  }

  return (
    <div className="admin">
      <aside className="side">
        <div className="side-brand">
          <span className="display">PAUSE</span>
          <span className="mono side-sub">ADMIN</span>
        </div>

        <nav className="side-nav mono">
          <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>
            <span className="nav-left"><IconGrid />Overview</span>
          </button>
          <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>
            <span className="nav-left"><IconBag />Orders</span>
            {stats.open > 0 && <span className="badge">{stats.open}</span>}
          </button>
          <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>
            <span className="nav-left"><IconTag />Products</span>
          </button>
          <button className={tab === 'hero' ? 'on' : ''} onClick={() => setTab('hero')}>
            <span className="nav-left"><IconImage />Homepage</span>
          </button>
          <button className={tab === 'menu' ? 'on' : ''} onClick={() => setTab('menu')}>
            <span className="nav-left"><IconList />Nav menus</span>
          </button>
          <button className={tab === 'wishlist' ? 'on' : ''} onClick={() => setTab('wishlist')}>
            <span className="nav-left"><IconStar />Wishlist</span>
            {demand.length > 0 && <span className="badge">{wishRows.length}</span>}
          </button>
          <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>
            <span className="nav-left"><IconImage />About us</span>
          </button>
        </nav>

        <div className="side-foot mono">
          <Link to="/"><IconExternal width="13" height="13" />View storefront</Link>
          <button onClick={handleSignOut} className="signout">
            <IconLogout width="13" height="13" />Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <div>
            <h1 className="display">
              {tab === 'overview' && 'Overview'}
              {tab === 'orders' && 'Orders'}
              {tab === 'products' && 'Products'}
              {tab === 'hero' && 'Homepage hero'}
              {tab === 'menu' && 'Nav menus'}
              {tab === 'wishlist' && 'Wishlist'}
              {tab === 'about' && 'About us page'}
            </h1>
            <div className="top-sub mono">{session.user?.email}</div>
          </div>
          <div className="top-date mono">
            {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </header>

        {loadError && <div className="err-banner mono">{loadError}</div>}
        {loading && <div className="loading mono">Loading…</div>}

        {!loading && tab === 'overview' && (
          <>
            <div className="stat-row three">
              <StatCard
                icon={<IconBox />}
                label="TOTAL ORDERS"
                value={stats.totalOrders}
                onClick={() => openOrders('all')}
                cta="All orders"
              />
              <StatCard
                icon={<IconTag />}
                label="PIECES SOLD"
                value={stats.unitsSold}
                note="Units across every order that wasn't cancelled"
              />
              <StatCard
                icon={<IconCash />}
                tone="good"
                label="REVENUE COLLECTED"
                value={taka(stats.revenue)}
                note={`Delivered orders only · ${taka(stats.openValue)} still to collect`}
              />
            </div>

            <div className="stat-row four">
              <StatCard
                icon={<IconClock />}
                tone="warn"
                label="PENDING"
                value={stats.pending}
                onClick={() => openOrders('pending')}
              />
              <StatCard
                icon={<IconTruck />}
                tone="warn"
                label="SHIPPED"
                value={stats.shipped}
                onClick={() => openOrders('shipped')}
              />
              <StatCard
                icon={<IconCheck />}
                tone="good"
                label="DELIVERED"
                value={stats.delivered}
                onClick={() => openOrders('delivered')}
              />
              <StatCard
                icon={<IconX />}
                tone="bad"
                label="CANCELLED"
                value={stats.cancelled}
                onClick={() => openOrders('cancelled')}
              />
            </div>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-label mono"><IconTrend width="13" height="13" />SALES BY MONTH</div>
                  <div className="panel-note" style={{ marginTop: '6px' }}>
                    {monthMetric === 'units'
                      ? 'Pieces sold each month, last 6 months.'
                      : 'Value of the orders placed each month, last 6 months.'}
                  </div>
                </div>
                <div className="toggle mono">
                  <button
                    className={monthMetric === 'units' ? 'on' : ''}
                    onClick={() => setMonthMetric('units')}
                  >
                    PIECES
                  </button>
                  <button
                    className={monthMetric === 'value' ? 'on' : ''}
                    onClick={() => setMonthMetric('value')}
                  >
                    REVENUE
                  </button>
                </div>
              </div>
              <MonthBars
                series={months}
                metric={monthMetric}
                format={(v) => (monthMetric === 'value' ? taka(v) : `${v} pcs`)}
              />
            </section>

            {lowStock.length > 0 && (
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <div className="panel-label mono"><IconBox width="13" height="13" />LOW STOCK</div>
                    <div className="panel-note" style={{ marginTop: '6px' }}>
                      Sizes with {LOW_STOCK_AT} pieces or fewer left. A size at 0 is
                      already sold out on the product page.
                    </div>
                  </div>
                  <button className="add-product mono" onClick={() => setTab('products')}>
                    Open products
                  </button>
                </div>

                <div className="low-rows">
                  {lowStock.map((r) => (
                    <div className={`low-row ${r.left === 0 ? 'out' : ''}`} key={`${r.id}-${r.size}`}>
                      <div>
                        <div className="mini-name">{r.name}</div>
                        <div className="mini-id mono" style={{ marginTop: '3px' }}>{r.variant}</div>
                      </div>
                      <div className="low-right mono">
                        <span className="low-size">{r.size}</span>
                        <span className="low-left">
                          {r.left === 0 ? 'SOLD OUT' : `${r.left} left`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="two-col">
              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>
                  <IconStar width="13" height="13" />SOLD BY DROP
                </div>
                <RankBars rows={byDrop} empty="No drop has sold anything yet." />
              </section>

              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>
                  <IconTag width="13" height="13" />SOLD BY CATEGORY
                </div>
                <RankBars rows={byCategory} empty="No category has sold anything yet." accent="cobalt" />
              </section>
            </div>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-label mono"><IconCash width="13" height="13" />DAILY MOMENTUM</div>
                  <div className="panel-note" style={{ marginTop: '6px' }}>
                    {windowOrders} order{windowOrders === 1 ? '' : 's'} placed in the last 14 days ·{' '}
                    {taka(windowValue)}
                  </div>
                </div>
                <div className="panel-tag mono"><IconTrend width="13" height="13" />14 DAYS</div>
              </div>
              <Sparkline series={series} />
              <div className="spark-axis mono">
                <span>{shortDate(series[0].date.toISOString())}</span>
                <span>{shortDate(series[series.length - 1].date.toISOString())}</span>
              </div>
            </section>

            <div className="two-col">
              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>
                  <IconTruck width="13" height="13" />RECENT ORDERS
                </div>
                {orders.length === 0 && <div className="empty mono">No orders yet.</div>}
                {orders.slice(0, 6).map((o) => (
                  <div className="mini-row" key={o.id}>
                    <div>
                      <div className="mini-id mono">{o.id}</div>
                      <div className="mini-name">{o.customer_name}</div>
                    </div>
                    <div className="mini-right">
                      <div className="mono">{taka(o.subtotal)}</div>
                      <span className={`pill ${o.status} mono`}>{o.status}</span>
                    </div>
                  </div>
                ))}
              </section>

              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>
                  <IconStar width="13" height="13" />TOP SELLERS
                </div>
                {top.length === 0 && <div className="empty mono">Nothing sold yet.</div>}
                {top.map((p, i) => (
                  <div className="mini-row" key={p.name}>
                    <div>
                      <div className="mini-id mono">{String(i + 1).padStart(2, '0')}</div>
                      <div className="mini-name">{p.name}</div>
                    </div>
                    <div className="mini-right">
                      <div className="mono">{p.units} sold</div>
                      <div className="mono dim">{taka(p.value)}</div>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </>
        )}

        {!loading && tab === 'orders' && (
          <section className="panel">
            <div className="chips mono">
              {['all', ...STATUSES].map((s) => (
                <button
                  key={s}
                  className={`chip ${s} ${statusFilter === s ? 'on' : ''}`}
                  onClick={() => {
                    setStatusFilter(s)
                    setExpanded(null)
                  }}
                >
                  {s === 'all' ? 'ALL' : s.toUpperCase()}
                  <span className="chip-count">{statusCounts[s]}</span>
                </button>
              ))}
            </div>

            <div className="orders-head">
              <div className="search-wrap">
                <IconSearch width="14" height="14" />
                <input
                  className="search mono"
                  placeholder="Search order ID, name or phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="mono dim">{filteredOrders.length} of {orders.length}</div>
            </div>

            {filteredOrders.length === 0 && <div className="empty mono">No matching orders.</div>}

            <div className="table">
              {filteredOrders.map((o) => (
                <div className="trow-wrap" key={o.id}>
                  <div className="trow" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                    <div className="tc mono id">{o.id}</div>
                    <div className="tc name">
                      {o.customer_name}
                      {lookupCustomer(customers, o.customer_phone).level === 'risk' && (
                        <span className="risk-tag mono">
                          {lookupCustomer(customers, o.customer_phone).cancelled} CANCELLED
                        </span>
                      )}
                    </div>
                    <div className="tc mono">{o.customer_phone}</div>
                    <div className="tc mono dim">{shortDate(o.created_at)}</div>
                    <div className="tc mono price">
                      {taka(o.total ?? o.subtotal)}
                      {Number(o.advance_amount) > 0 && <span className="adv-tag">ADV</span>}
                    </div>
                    <div className="tc">
                      <select
                        className={`status-select ${o.status} mono`}
                        value={o.status}
                        disabled={savingId === o.id}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleStatusChange(o.id, e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div className={`tc chev ${expanded === o.id ? 'open' : ''}`}>
                      <IconChevron width="14" height="14" />
                    </div>
                  </div>

                  {expanded === o.id && (
                    <div className="tdetail">
                      <div className="tdetail-col">
                        <div className="dlabel mono">ITEMS</div>
                        {(o.order_items || []).map((it) => (
                          <div className="ditem" key={it.id}>
                            <span>{it.product_name} · {it.size} × {it.qty}</span>
                            <span className="mono">{taka(it.price * it.qty)}</span>
                          </div>
                        ))}
                        {(!o.order_items || o.order_items.length === 0) && (
                          <div className="mono dim">No line items recorded.</div>
                        )}

                        {/* Everything this phone number has done with us, so the
                            confirmation call can be made knowing whether the
                            last two parcels came back. */}
                        <div className="dlabel mono" style={{ marginTop: '16px' }}>THIS NUMBER</div>
                        {(() => {
                          const h = lookupCustomer(customers, o.customer_phone)

                          if (h.level === 'new') {
                            return <div className="hist mono">First order from this number.</div>
                          }

                          return (
                            <>
                              <div className={`hist ${h.level} mono`}>
                                <span className="hist-dot" />
                                {h.total} orders · {h.delivered} delivered · {h.cancelled} cancelled
                                {h.open > 1 && ` · ${h.open} open`}
                              </div>
                              <div className="hist-note mono">
                                {h.level === 'risk'
                                  ? 'Refused before — worth confirming by phone before it ships.'
                                  : h.level === 'watch'
                                    ? 'One refusal on record.'
                                    : `${taka(h.collected)} collected from this customer.`}
                              </div>
                            </>
                          )
                        })()}
                      </div>
                      <div className="tdetail-col">
                        <div className="dlabel mono">DELIVERY</div>
                        <div className="daddr">{o.customer_address}</div>
                        <div className="daddr mono dim">{o.customer_area}</div>
                        {o.customer_note && (
                          <>
                            <div className="dlabel mono" style={{ marginTop: '14px' }}>NOTE</div>
                            <div className="daddr">{o.customer_note}</div>
                          </>
                        )}

                        {/* What the rider actually collects — the advance, if
                            there was one, is already in hand. */}
                        <div className="dlabel mono" style={{ marginTop: '14px' }}>PAYMENT</div>
                        <div className="ditem">
                          <span>Items</span>
                          <span className="mono">{taka(o.subtotal)}</span>
                        </div>
                        {/* Keyed off the zone, not the fee: the fee column was
                            added with a default of 0, so orders taken before
                            delivery charges existed carry a 0 rather than a
                            null and would show a free delivery line. */}
                        {o.delivery_zone && (
                          <div className="ditem">
                            <span>
                              Delivery · {o.delivery_zone === 'inside' ? 'Inside' : 'Outside'} Dhaka
                            </span>
                            <span className="mono">{taka(o.delivery_fee ?? 0)}</span>
                          </div>
                        )}
                        {Number(o.advance_amount) > 0 && (
                          <div className="ditem">
                            <span>Advance · bKash <span className="mono trx">{o.advance_trx_id}</span></span>
                            <span className="mono">− {taka(o.advance_amount)}</span>
                          </div>
                        )}
                        <div className="ditem collect">
                          <span>{Number(o.advance_amount) > 0 ? 'Cash to collect' : 'Total (COD)'}</span>
                          <span className="mono">
                            {taka((o.total ?? o.subtotal) - (Number(o.advance_amount) || 0))}
                          </span>
                        </div>

                        <div className="dlabel mono" style={{ marginTop: '16px' }}>COURIER</div>
                        {o.consignment_id ? (
                          <>
                            <div className="ditem">
                              <span>{courierLabel(o.courier)}</span>
                              <span className="mono">{o.consignment_id}</span>
                            </div>
                            <div className="courier-row">
                              <span className="mono dim">
                                {o.courier_status || 'booked'}
                                {o.courier_synced_at && ` · synced ${shortDate(o.courier_synced_at)}`}
                              </span>
                              <button
                                className="courier-btn ghost mono"
                                disabled={courierBusy === o.id}
                                onClick={() => handleCourierSync(o)}
                              >
                                {courierBusy === o.id ? 'Checking…' : 'Sync status'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="courier-row">
                            <select
                              className="courier-select mono"
                              value={courierPick[o.id] || COURIERS[0].key}
                              onChange={(e) =>
                                setCourierPick({ ...courierPick, [o.id]: e.target.value })
                              }
                            >
                              {COURIERS.map((c) => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                              ))}
                            </select>
                            <button
                              className="courier-btn mono"
                              disabled={courierBusy === o.id}
                              onClick={() => handleCourierSend(o)}
                            >
                              {courierBusy === o.id ? 'Sending…' : 'Send to courier'}
                            </button>
                          </div>
                        )}

                        <button className="courier-btn ghost mono slip-btn" onClick={() => setSlipOrder(o)}>
                          Print packing slip
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && tab === 'products' && editing && (
          <ProductForm
            existing={editing === 'new' ? null : editing}
            categories={productCategories}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null)
              reload()
            }}
          />
        )}

        {!loading && tab === 'products' && !editing && (
          <section className="panel">
            <div className="orders-head">
              <div className="panel-note mono">
                Click a product to edit it. Images upload straight to Cloudinary.
              </div>
              <button className="add-product mono" onClick={() => setEditing('new')}>
                + Add product
              </button>
            </div>

            {products.length === 0 && <div className="empty mono">No products in the catalog.</div>}

            <div className="table">
              {products.map((p) => (
                <div
                  className="trow prow clickable"
                  key={p.id}
                  onClick={() => setEditing(p)}
                >
                  <div className="pthumb">
                    {Array.isArray(p.images) && p.images[0] && <img src={cld(p.images[0], { w: 120 })} alt="" />}
                  </div>
                  <div className="tc name">{p.name}</div>
                  <div className="tc mono dim">{p.variant}</div>
                  <div className="tc mono">{taka(p.price)}</div>
                  <div className="tc mono dim">
                    {stockMap(p) ? (
                      <span className="stock-chips">
                        {(p.sizes || []).map((s) => {
                          const n = stockMap(p)[s] ?? 0
                          return (
                            <span
                              key={s}
                              className={`chip-stock ${n === 0 ? 'out' : n <= LOW_STOCK_AT ? 'low' : ''}`}
                            >
                              {s} {n}
                            </span>
                          )
                        })}
                      </span>
                    ) : (
                      Array.isArray(p.sizes) ? p.sizes.join(' · ') : ''
                    )}
                  </div>
                  <div className="tc mono">
                    {totalStock(p) === 0 && <span className="out-tag">Sold out</span>}
                    {totalStock(p) === null &&
                      Array.isArray(p.sizes_out) &&
                      p.sizes_out.length > 0 && (
                        <span className="out-tag">{p.sizes_out.length} size out</span>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {!loading && tab === 'wishlist' && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-label mono"><IconStar width="13" height="13" />RESTOCK DEMAND</div>
                <div className="panel-note" style={{ marginTop: '6px' }}>
                  People waiting on a sold-out size, busiest first. Restocking a
                  size in the product form mails everyone on its list — this is
                  the same send, by hand, if one needs repeating.
                </div>
              </div>
            </div>

            {demand.length === 0 && (
              <div className="empty mono">Nobody is waiting on anything right now.</div>
            )}

            <div className="low-rows">
              {demand.map((g) => (
                <div className="wish-group" key={g.key}>
                  <div className="low-row">
                    <div>
                      <div className="mini-name">{g.name}</div>
                      <div className="mini-id mono" style={{ marginTop: '3px' }}>
                        {g.size ? `SIZE ${g.size}` : 'WHOLE PRODUCT'} · waiting since{' '}
                        {shortDate(g.waitingSince)}
                      </div>
                    </div>
                    <div className="low-right mono">
                      <span className="low-size">{g.emails.length} waiting</span>
                      <button
                        className="wish-send mono"
                        disabled={notifying === g.key}
                        onClick={() => handleNotify(g)}
                      >
                        {notifying === g.key ? 'Sending…' : 'Email them'}
                      </button>
                    </div>
                  </div>
                  <div className="wish-emails mono">{g.emails.join(' · ')}</div>
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'hero' && <HeroManager />}
        {!loading && tab === 'menu' && (
          <>
            <CategoryManager menu="shop" products={products} />
            <CategoryManager menu="drops" products={products} />
          </>
        )}
        {tab === 'about' && <AboutManager />}
      </main>

      {slipOrder && <PackingSlip order={slipOrder} />}
    </div>
  )
}
