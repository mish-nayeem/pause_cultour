import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
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
  salesByAttribution,
  topProducts,
  lowStockSizes,
  customerIndex,
  lookupCustomer,
  fetchReturns,
  createReturn,
  resolveReturn,
  fetchAbandonedCarts,
  fetchBlockedAttempts,
  customerList,
  repeatVsNew,
  costAndMargin,
  fetchAllReviews,
  adSpendApi,
  emailCampaignsApi,
  socialStatsApi,
  couponStatsApi,
  fetchPageViews,
  trafficByPage,
  conversionRate,
  salesByDistrict,
} from '../lib/admin.js'
import { sendStatusUpdate, sendRestockAlert } from '../lib/email.js'
import { cld } from '../lib/cloudinary.js'
import ProductForm from '../components/ProductForm.jsx'
import { collectLabels } from '../lib/details.js'
import HeroManager from '../components/HeroManager.jsx'
import CategoryManager from '../components/CategoryManager.jsx'
import AboutManager from '../components/AboutManager.jsx'
import LinkGenerator from '../components/LinkGenerator.jsx'
import ManualOrderForm from '../components/ManualOrderForm.jsx'
import { fetchAllNavCategories } from '../lib/navCategories.js'
import { stockMap, totalStock, LOW_STOCK_AT } from '../lib/stock.js'
import { fetchWishlist, groupDemand } from '../lib/wishlist.js'
import { COURIERS, courierLabel, sendToCourier, syncCourierStatus } from '../lib/courier.js'
import { whatsappLink, shopToCustomerMessage } from '../lib/whatsapp.js'
import {
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
  IconChat,
  IconImage,
} from '../components/Icons.jsx'
import './admin.css'
import './admin-theme.css'

const STATUSES = ['pending', 'shipped', 'delivered', 'cancelled']

const TAB_LABELS = {
  overview: 'Overview',
  orders: 'Orders',
  products: 'Products / Inventory',
  customers: 'Customers',
  marketing: 'Marketing',
  analytics: 'Analytics',
  hero: 'Homepage hero',
  menu: 'Nav menus',
  about: 'About us page',
}

// One accent per section in the dark theme, so the sidebar reads as a set of
// distinct areas rather than one long list; the lighter themes use a single
// accent instead (see admin-theme.css).
const SECTION_COLORS = {
  overview: '#3FC1FF',
  orders: '#FF5E7E',
  products: '#3DDC97',
  customers: '#FFC14D',
  marketing: '#7C6CFF',
  analytics: '#3FC1FF',
  hero: '#3DDC97',
  menu: '#FFC14D',
  about: '#FF5E7E',
}

const OVERVIEW_SUBS = [
  { key: 'stats', label: 'Key stats' },
  { key: 'trend', label: 'Sales trend' },
  { key: 'catalog', label: 'Catalog' },
  { key: 'recent', label: 'Recent orders' },
]

const ORDERS_SUBS = [
  { key: 'list', label: 'Order list' },
  { key: 'returns', label: 'Refunds & returns' },
  { key: 'abandoned', label: 'Abandoned cart' },
  { key: 'security', label: 'Security' },
]

const PRODUCTS_SUBS = [
  { key: 'catalog', label: 'Product catalog' },
  { key: 'stock', label: 'Stock levels' },
  { key: 'best', label: 'Best sellers' },
  { key: 'margin', label: 'Cost & margin' },
]

const CUSTOMERS_SUBS = [
  { key: 'list', label: 'Customer list' },
  { key: 'repeat', label: 'Repeat vs new' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'wishlist', label: 'Wishlist' },
]

const MARKETING_SUBS = [
  { key: 'adspend', label: 'Ad spend / ROAS' },
  { key: 'email', label: 'Email campaigns' },
  { key: 'social', label: 'Social tracking' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'links', label: 'Tracked links' },
]

const ANALYTICS_SUBS = [
  { key: 'traffic', label: 'Visitor traffic' },
  { key: 'conversion', label: 'Conversion rate' },
  { key: 'location', label: 'Location map' },
  { key: 'category', label: 'Sold by category' },
]

// The three looks the panel can wear — see admin-theme.css. The pick is kept in
// this browser, so it survives a reload without touching the database.
const THEMES = [
  { key: 'green', label: 'Green & white' },
  { key: 'blue', label: 'Blue & white' },
  { key: 'dark', label: 'Black & grey' },
]

const THEME_KEY = 'pause_admin_theme'

function savedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return THEMES.some((t) => t.key === saved) ? saved : 'dark'
  } catch {
    return 'dark'
  }
}

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
function RankBars({ rows, empty, accent, countKey = 'units', countLabel = 'pcs' }) {
  if (rows.length === 0) return <div className="empty mono">{empty}</div>

  const max = Math.max(1, ...rows.map((r) => r[countKey]))

  return (
    <div className={`hbars ${accent || ''}`}>
      {rows.map((r) => (
        <div className="hbar" key={r.name}>
          <div className="hbar-top">
            <span className="hbar-name">{r.name}</span>
            <span className="hbar-val mono">
              {r[countKey]} {countLabel}<span className="dim"> · {taka(r.value)}</span>
            </span>
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${Math.max(2, (r[countKey] / max) * 100)}%` }} />
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
  const [theme, setTheme] = useState(savedTheme)
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
  const [addingOrder, setAddingOrder] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [overviewSub, setOverviewSub] = useState('stats')
  const [ordersSub, setOrdersSub] = useState('list')
  const [returns, setReturns] = useState([])
  const [abandonedCarts, setAbandonedCarts] = useState([])
  const [blockedAttempts, setBlockedAttempts] = useState([])
  const [returnForm, setReturnForm] = useState({ orderId: '', reason: '' })
  const [returnBusy, setReturnBusy] = useState(null)
  const [adSpendDraft, setAdSpendDraft] = useState({ channel: '', spend: '', revenue: '' })
  const [emailDraft, setEmailDraft] = useState({ campaign: '', open_rate: '', click_rate: '' })
  const [socialDraft, setSocialDraft] = useState({ platform: '', followers: '', engagement_rate: '' })
  const [couponDraft, setCouponDraft] = useState({ code: '', uses: '', revenue: '' })
  const [marketingBusy, setMarketingBusy] = useState(null)
  const [analyticsSub, setAnalyticsSub] = useState('traffic')
  const [pageViews, setPageViews] = useState([])
  const [productsSub, setProductsSub] = useState('catalog')
  const [customersSub, setCustomersSub] = useState('list')
  const [allReviews, setAllReviews] = useState([])
  const [marketingSub, setMarketingSub] = useState('adspend')
  const [adSpend, setAdSpend] = useState([])
  const [emailCampaigns, setEmailCampaigns] = useState([])
  const [socialStats, setSocialStats] = useState([])
  const [couponStats, setCouponStats] = useState([])

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

    const [o, p, c, w, r, ac, rv, as, ec, ss, cs, pv, ba] = await Promise.all([
      fetchOrders(),
      fetchAdminProducts(),
      fetchAllNavCategories(),
      fetchWishlist(),
      fetchReturns(),
      fetchAbandonedCarts(),
      fetchAllReviews(),
      adSpendApi.fetch(),
      emailCampaignsApi.fetch(),
      socialStatsApi.fetch(),
      couponStatsApi.fetch(),
      fetchPageViews(),
      fetchBlockedAttempts(),
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
    setReturns(r.returns)
    setAbandonedCarts(ac.carts)
    setAllReviews(rv.reviews)
    setAdSpend(as.rows)
    setEmailCampaigns(ec.rows)
    setSocialStats(ss.rows)
    setCouponStats(cs.rows)
    setPageViews(pv.views)
    setBlockedAttempts(ba.attempts)
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
  const byAttribution = useMemo(() => salesByAttribution(orders), [orders])
  const top = useMemo(() => topProducts(orders, 5), [orders])
  const lowStock = useMemo(() => lowStockSizes(products), [products])
  const demand = useMemo(() => groupDemand(wishRows), [wishRows])
  const customers = useMemo(() => customerIndex(orders), [orders])
  const custList = useMemo(() => customerList(orders), [orders])
  const custSplit = useMemo(() => repeatVsNew(orders), [orders])
  const margins = useMemo(() => costAndMargin(products), [products])
  const traffic = useMemo(() => trafficByPage(pageViews), [pageViews])
  const conversion = useMemo(() => conversionRate(pageViews, orders), [pageViews, orders])
  const byDistrict = useMemo(() => salesByDistrict(orders), [orders])

  // One row per product, every size's count sitting side by side — same
  // stock-chips a product's catalog row already shows, just without the rest
  // of the columns. An untracked product (no stock map at all) has no
  // quantity to show, so it's left out rather than shown blank.
  const trackedProducts = useMemo(() => products.filter((p) => stockMap(p) !== null), [products])

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

  // The sidebar drawer only exists on a phone width, but this runs on every
  // width rather than checking — closing a drawer that isn't open is a no-op.
  function goTab(key) {
    setTab(key)
    setMobileMenuOpen(false)
  }

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

  async function handleAddReturn(e) {
    e.preventDefault()
    if (!returnForm.orderId || !returnForm.reason.trim()) return

    setReturnBusy('new')
    const { error } = await createReturn({
      orderId: returnForm.orderId,
      reason: returnForm.reason.trim(),
    })
    setReturnBusy(null)

    if (error) {
      setLoadError("Couldn't log that return. Try again.")
      return
    }

    setReturnForm({ orderId: '', reason: '' })
    reload()
  }

  async function handleResolveReturn(id) {
    setReturnBusy(id)
    const { error } = await resolveReturn(id)
    setReturnBusy(null)

    if (error) {
      setLoadError("Couldn't update that return. Try again.")
      return
    }

    reload()
  }

  // One handler for all four Marketing tables — same shape every time: add a
  // row through the table's api, clear the draft, reload. `numericKeys` says
  // which fields to parse as numbers before the insert.
  async function handleMarketingAdd(api, draft, setDraft, numericKeys) {
    setMarketingBusy(api)
    const row = { ...draft }
    numericKeys.forEach((k) => { row[k] = Number(row[k]) || 0 })

    const { error } = await api.add(row)
    setMarketingBusy(null)

    if (error) {
      setLoadError("Couldn't save that row. Try again.")
      return
    }

    setDraft(Object.fromEntries(Object.keys(draft).map((k) => [k, ''])))
    reload()
  }

  async function handleMarketingDelete(api, id) {
    setMarketingBusy(id)
    await api.remove(id)
    setMarketingBusy(null)
    reload()
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
    return <Navigate to="/login?next=/admin" replace />
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

  const navItems = [
    { key: 'overview', label: 'Overview', badge: null },
    { key: 'orders', label: 'Orders', badge: stats.open > 0 ? stats.open : null },
    { key: 'products', label: 'Products / Inventory', badge: null },
    { key: 'customers', label: 'Customers', badge: demand.length > 0 ? wishRows.length : null },
    { key: 'marketing', label: 'Marketing', badge: null },
    { key: 'analytics', label: 'Analytics', badge: null },
    { key: 'hero', label: 'Homepage', badge: null },
    { key: 'menu', label: 'Nav menus', badge: null },
    { key: 'about', label: 'About us', badge: null },
  ]

  return (
    <div className="admin" data-theme={theme} data-tab={tab}>
      <div className="admin-topbar">
        <button
          type="button"
          className="admin-burger"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open menu"
        >
          <span /><span /><span />
        </button>
        <span className="display admin-topbar-brand">PAUSE ADMIN</span>
      </div>

      {mobileMenuOpen && (
        <div className="admin-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      <aside className={`side ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="side-brand">
          <span className="display">PAUSE</span>
          <span className="mono side-sub">ADMIN</span>
        </div>

        <nav className="side-nav mono">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? 'on' : ''}
              style={{ '--item-color': SECTION_COLORS[item.key] }}
              onClick={() => goTab(item.key)}
            >
              <span className="nav-left">
                <span className="nav-dot" />
                {item.label}
              </span>
              {item.badge != null && <span className="badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="side-foot mono">
          <Link to="/"><IconExternal width="13" height="13" />View storefront</Link>
          <button onClick={handleSignOut} className="signout">
            <IconLogout width="13" height="13" />Sign out
          </button>
        </div>
      </aside>

      <main className="main">
      <div className="tab-wrap" key={tab}>
        <header className="top">
          <div>
            <div className="admin-crumb mono">
              ADMIN / {TAB_LABELS[tab].toUpperCase()}
              {tab === 'overview' &&
                ` / ${OVERVIEW_SUBS.find((s) => s.key === overviewSub).label.toUpperCase()}`}
              {tab === 'orders' &&
                ` / ${ORDERS_SUBS.find((s) => s.key === ordersSub).label.toUpperCase()}`}
              {tab === 'products' &&
                ` / ${PRODUCTS_SUBS.find((s) => s.key === productsSub).label.toUpperCase()}`}
              {tab === 'customers' &&
                ` / ${CUSTOMERS_SUBS.find((s) => s.key === customersSub).label.toUpperCase()}`}
              {tab === 'marketing' &&
                ` / ${MARKETING_SUBS.find((s) => s.key === marketingSub).label.toUpperCase()}`}
              {tab === 'analytics' &&
                ` / ${ANALYTICS_SUBS.find((s) => s.key === analyticsSub).label.toUpperCase()}`}
            </div>
            <h1 className="display">{TAB_LABELS[tab]}</h1>
            <div className="top-sub mono">{session.user?.email}</div>
          </div>
          <div className="top-right">
            <div className="theme-picker" role="radiogroup" aria-label="Dashboard theme">
              <span className="theme-picker-label">Theme</span>
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.key}
                  aria-label={t.label}
                  title={t.label}
                  data-swatch={t.key}
                  className={`theme-swatch ${theme === t.key ? 'on' : ''}`}
                  onClick={() => {
                    setTheme(t.key)
                    try { localStorage.setItem(THEME_KEY, t.key) } catch { /* not remembered */ }
                  }}
                />
              ))}
            </div>
            <div className="top-date mono">
              {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </header>

        {loadError && <div className="err-banner mono">{loadError}</div>}
        {loading && <div className="loading mono">Loading…</div>}

        {!loading && tab === 'overview' && (
          <div>
            <div className="subtabs mono">
              {OVERVIEW_SUBS.map((s) => (
                <button
                  key={s.key}
                  className={`subtab ${overviewSub === s.key ? 'active' : ''}`}
                  onClick={() => setOverviewSub(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {overviewSub === 'stats' && (
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
              </>
            )}

            {overviewSub === 'trend' && (
              <>
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
              </>
            )}

            {overviewSub === 'catalog' && lowStock.length > 0 && (
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

            {overviewSub === 'catalog' && (
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
            )}

            {overviewSub === 'recent' && (
            <section className="panel">
              <div className="panel-label mono" style={{ marginBottom: '6px' }}>
                <IconTrend width="13" height="13" />ORDERS BY SOURCE
              </div>
              <div className="panel-note" style={{ marginBottom: '18px' }}>
                Where each order's link came from — reel, story or bio, tagged with
                ?utm_source. Orders with no tag were typed in or bookmarked directly.
              </div>
              <RankBars
                rows={byAttribution}
                empty="No orders yet."
                accent="cobalt"
                countKey="orders"
                countLabel="orders"
              />
            </section>
            )}

            {overviewSub === 'trend' && (
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
            )}

            {overviewSub === 'recent' && (
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
            )}
          </div>
        )}

        {!loading && tab === 'orders' && addingOrder && (
          <ManualOrderForm
            products={products}
            onCancel={() => setAddingOrder(false)}
            onDone={() => {
              setAddingOrder(false)
              reload()
            }}
          />
        )}

        {!loading && tab === 'orders' && !addingOrder && (
          <>
          <div className="subtabs mono">
            {ORDERS_SUBS.map((s) => (
              <button
                key={s.key}
                className={`subtab ${ordersSub === s.key ? 'active' : ''}`}
                onClick={() => setOrdersSub(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {ordersSub === 'list' && (
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
              <div className="orders-head-right">
                <div className="mono dim">{filteredOrders.length} of {orders.length}</div>
                <button className="add-product mono" onClick={() => setAddingOrder(true)}>
                  + New order
                </button>
              </div>
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
                    <div className="tc mono">
                      {o.customer_phone}
                      <a
                        className="wa-mini"
                        href={whatsappLink(o.customer_phone, shopToCustomerMessage(o))}
                        target="_blank"
                        rel="noreferrer"
                        title="Message on WhatsApp"
                        aria-label={`Message ${o.customer_name} on WhatsApp`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IconChat width="14" height="14" />
                      </a>
                    </div>
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

                        {o.utm_source && (
                          <>
                            <div className="dlabel mono" style={{ marginTop: '16px' }}>SOURCE</div>
                            <div className="mono dim">
                              {o.utm_source}
                              {o.utm_medium && ` · ${o.utm_medium}`}
                              {o.utm_campaign && ` · ${o.utm_campaign}`}
                            </div>
                          </>
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

                        <a
                          className="wa-btn"
                          href={whatsappLink(o.customer_phone, shopToCustomerMessage(o))}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <IconChat width="15" height="15" />
                          WhatsApp customer
                        </a>

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

          {ordersSub === 'returns' && (
            <>
              <form className="pform" onSubmit={handleAddReturn}>
                <div className="pform-head">
                  <h3 className="display">Log a return</h3>
                </div>
                <div className="pf-note">
                  For a refund or return raised over DM or a call — this doesn't
                  touch stock or the order itself, it's just a record to track
                  down to resolved.
                </div>
                <div className="pf-grid">
                  <label className="pf-field">
                    <span className="mono">ORDER</span>
                    <select
                      value={returnForm.orderId}
                      onChange={(e) => setReturnForm({ ...returnForm, orderId: e.target.value })}
                    >
                      <option value="">Select order</option>
                      {orders.map((o) => (
                        <option key={o.id} value={o.id}>{o.id} — {o.customer_name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="pf-field">
                    <span className="mono">REASON</span>
                    <input
                      value={returnForm.reason}
                      onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })}
                      placeholder="Wrong size, changed mind, damaged…"
                    />
                  </label>
                </div>
                <button type="submit" className="mof-submit mono" disabled={returnBusy === 'new'}>
                  {returnBusy === 'new' ? 'Logging…' : 'Log return'}
                </button>
              </form>

              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>
                  REFUNDS &amp; RETURNS
                </div>
                {returns.length === 0 && <div className="empty mono">No returns logged.</div>}
                {returns.map((r) => (
                  <div className="mini-row" key={r.id}>
                    <div>
                      <div className="mini-id mono">{r.order_id}</div>
                      <div className="mini-name">{r.reason}</div>
                      {r.orders?.customer_name && (
                        <div className="mono dim" style={{ marginTop: '3px', fontSize: '11px' }}>
                          {r.orders.customer_name}
                        </div>
                      )}
                    </div>
                    <div className="mini-right">
                      <span className={`pill ${r.status === 'open' ? 'pending' : 'delivered'} mono`}>
                        {r.status}
                      </span>
                      {r.status === 'open' && (
                        <button
                          className="courier-btn ghost mono"
                          disabled={returnBusy === r.id}
                          onClick={() => handleResolveReturn(r.id)}
                        >
                          {returnBusy === r.id ? 'Saving…' : 'Mark resolved'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}

          {ordersSub === 'abandoned' && (
            <section className="panel">
              <div className="panel-label mono" style={{ marginBottom: '6px' }}>
                ABANDONED CART
              </div>
              <div className="panel-note" style={{ marginBottom: '18px' }}>
                Checkouts the storefront saw items reach but never turned into an
                order. Clears itself the moment that same browser's order goes through.
              </div>
              {abandonedCarts.length === 0 && <div className="empty mono">Nothing abandoned right now.</div>}
              {abandonedCarts.map((c) => (
                <div className="mini-row" key={c.session_id}>
                  <div>
                    <div className="mini-name">{c.customer_name || 'Anonymous'}</div>
                    <div className="mini-id mono" style={{ marginTop: '3px' }}>
                      {(c.items || []).map((it) => `${it.name} × ${it.qty}`).join(', ')}
                    </div>
                  </div>
                  <div className="mini-right">
                    <div className="mono">{taka(c.cart_value)}</div>
                    <div className="mono dim">{shortDate(c.last_active)}</div>
                  </div>
                </div>
              ))}
            </section>
          )}

          {ordersSub === 'security' && (
            <section className="panel">
              <div className="panel-label mono" style={{ marginBottom: '6px' }}>
                BLOCKED ORDER ATTEMPTS
              </div>
              <div className="panel-note" style={{ marginBottom: '18px' }}>
                place_order refuses more than 8 orders an hour from the same
                IP (see supabase-migration-rate-limiting.sql) — every one it
                turned away shows up here with whatever phone, email and name
                it was made up with, so a burst of fake orders is something
                you can actually see instead of just a blocked customer you
                never hear about.
              </div>
              {blockedAttempts.length === 0 && (
                <div className="empty mono">No blocked attempts — nothing's tripped the limit.</div>
              )}
              {blockedAttempts.map((a) => (
                <div className="mini-row" key={a.id}>
                  <div>
                    <div className="mini-name">{a.name || 'No name given'}</div>
                    <div className="mini-id mono" style={{ marginTop: '3px' }}>
                      {a.phone || '—'}{a.email ? ` · ${a.email}` : ''}
                    </div>
                  </div>
                  <div className="mini-right">
                    <div className="mono">{a.ip || 'unknown IP'}</div>
                    <div className="mono dim">{shortDate(a.created_at)}</div>
                  </div>
                </div>
              ))}
            </section>
          )}
          </>
        )}

        {!loading && tab === 'products' && editing && (
          <ProductForm
            existing={editing === 'new' ? null : editing}
            categories={productCategories}
            detailLabels={collectLabels(products)}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null)
              reload()
            }}
          />
        )}

        {!loading && tab === 'products' && !editing && (
          <>
          <div className="subtabs mono">
            {PRODUCTS_SUBS.map((s) => (
              <button
                key={s.key}
                className={`subtab ${productsSub === s.key ? 'active' : ''}`}
                onClick={() => setProductsSub(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {productsSub === 'catalog' && (
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
                  <div className="tc name">
                    {p.name}
                    <div className="mini-id mono" style={{ marginTop: '2px' }}>{p.id}</div>
                  </div>
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

          {productsSub === 'stock' && (
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '18px' }}>STOCK LEVELS</div>
            {trackedProducts.length === 0 && <div className="empty mono">No tracked stock yet.</div>}
            {trackedProducts.map((p) => {
              const map = stockMap(p)
              return (
                <div className="mini-row" key={p.id}>
                  <div>
                    <div className="mini-name">{p.name}</div>
                    <div className="mini-id mono" style={{ marginTop: '3px' }}>{p.id} · {p.variant}</div>
                  </div>
                  <span className="stock-chips">
                    {(p.sizes || []).map((s) => {
                      const n = map[s] ?? 0
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
                </div>
              )
            })}
          </section>
          )}

          {productsSub === 'best' && (
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '18px' }}>
              <IconStar width="13" height="13" />BEST SELLERS
            </div>
            {top.length === 0 && <div className="empty mono">Nothing sold yet.</div>}
            {top.map((p, i) => (
              <div className="mini-row" key={p.id || p.name}>
                <div>
                  <div className="mini-name">{String(i + 1).padStart(2, '0')} · {p.name}</div>
                  <div className="mini-id mono" style={{ marginTop: '3px' }}>{p.id || '—'}</div>
                </div>
                <div className="mini-right">
                  <div className="mono">{p.units} sold</div>
                  <div className="mono dim">{taka(p.value)}</div>
                </div>
              </div>
            ))}
          </section>
          )}

          {productsSub === 'margin' && (
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '6px' }}>COST &amp; MARGIN</div>
            <div className="panel-note" style={{ marginBottom: '18px' }}>
              Only products with a cost entered in the product form show up here.
            </div>
            {margins.length === 0 && <div className="empty mono">No product has a cost entered yet.</div>}
            {margins.map((m) => (
              <div className="mini-row" key={m.id}>
                <div>
                  <div className="mini-name">{m.name}</div>
                  <div className="mini-id mono" style={{ marginTop: '3px' }}>{m.id} · {m.variant}</div>
                </div>
                <div className="mini-right">
                  <div className="mono">{m.margin.toFixed(0)}% margin</div>
                  <div className="mono dim">{taka(m.cost)} → {taka(m.price)}</div>
                </div>
              </div>
            ))}
          </section>
          )}
          </>
        )}
        {!loading && tab === 'customers' && (
          <>
          <div className="subtabs mono">
            {CUSTOMERS_SUBS.map((s) => (
              <button
                key={s.key}
                className={`subtab ${customersSub === s.key ? 'active' : ''}`}
                onClick={() => setCustomersSub(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {customersSub === 'list' && (
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '18px' }}>CUSTOMER LIST</div>
            {custList.length === 0 && <div className="empty mono">No orders yet.</div>}
            {custList.map((c) => (
              <div className="mini-row" key={c.phone}>
                <div>
                  <div className="mini-name">{c.name}</div>
                  <div className="mini-id mono" style={{ marginTop: '3px' }}>{c.phone}</div>
                </div>
                <div className="mini-right">
                  <div className="mono">{c.orders} order{c.orders === 1 ? '' : 's'}</div>
                  <div className="mono dim">{taka(c.totalSpent)}</div>
                </div>
              </div>
            ))}
          </section>
          )}

          {customersSub === 'repeat' && (
          <div className="stat-row three">
            <StatCard label="TOTAL CUSTOMERS" value={custSplit.new + custSplit.repeat} icon={<IconStar />} />
            <StatCard label="NEW (1 ORDER)" value={custSplit.new} icon={<IconBox />} />
            <StatCard label="REPEAT (2+ ORDERS)" tone="good" value={custSplit.repeat} icon={<IconCheck />} />
          </div>
          )}

          {customersSub === 'reviews' && (
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '18px' }}>REVIEWS</div>
            {allReviews.length === 0 && <div className="empty mono">No reviews yet.</div>}
            {allReviews.map((r) => {
              const product = products.find((p) => String(p.id) === String(r.product_id))
              return (
                <div className="mini-row" key={r.id}>
                  <div>
                    <div className="mini-name">{product ? product.name : r.product_id}</div>
                    <div className="mini-id mono" style={{ marginTop: '3px' }}>
                      {r.customer_name}{r.comment ? ` — ${r.comment}` : ''}
                    </div>
                  </div>
                  <div className="mono dim">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                </div>
              )
            })}
          </section>
          )}

          {customersSub === 'wishlist' && (
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
          </>
        )}
        {tab === 'hero' && <HeroManager />}
        {!loading && tab === 'menu' && (
          <>
            <CategoryManager menu="shop" products={products} />
            <CategoryManager menu="drops" products={products} />
          </>
        )}
        {!loading && tab === 'marketing' && (
          <>
          <div className="subtabs mono">
            {MARKETING_SUBS.map((s) => (
              <button
                key={s.key}
                className={`subtab ${marketingSub === s.key ? 'active' : ''}`}
                onClick={() => setMarketingSub(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {marketingSub === 'adspend' && (
            <>
              <form
                className="pform"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!adSpendDraft.channel.trim()) return
                  handleMarketingAdd(adSpendApi, adSpendDraft, setAdSpendDraft, ['spend', 'revenue'])
                }}
              >
                <div className="pform-head"><h3 className="display">Log ad spend</h3></div>
                <div className="pf-note">Cost per channel vs the revenue it brought in — both typed in by hand for now.</div>
                <div className="pf-grid">
                  <label className="pf-field">
                    <span className="mono">CHANNEL</span>
                    <input value={adSpendDraft.channel} onChange={(e) => setAdSpendDraft({ ...adSpendDraft, channel: e.target.value })} placeholder="FB Ads, IG Boost…" />
                  </label>
                  <label className="pf-field">
                    <span className="mono">SPEND (৳)</span>
                    <input type="number" value={adSpendDraft.spend} onChange={(e) => setAdSpendDraft({ ...adSpendDraft, spend: e.target.value })} />
                  </label>
                  <label className="pf-field">
                    <span className="mono">REVENUE (৳)</span>
                    <input type="number" value={adSpendDraft.revenue} onChange={(e) => setAdSpendDraft({ ...adSpendDraft, revenue: e.target.value })} />
                  </label>
                </div>
                <button type="submit" className="mof-submit mono" disabled={marketingBusy === adSpendApi}>
                  {marketingBusy === adSpendApi ? 'Saving…' : 'Add row'}
                </button>
              </form>

              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>AD SPEND / ROAS</div>
                {adSpend.length === 0 && <div className="empty mono">Nothing logged yet.</div>}
                {adSpend.map((r) => (
                  <div className="mini-row" key={r.id}>
                    <div className="mini-name">{r.channel}</div>
                    <div className="mini-right">
                      <div className="mono">{taka(r.spend)} → {taka(r.revenue)}</div>
                      <div className="mono dim">{r.spend > 0 ? (r.revenue / r.spend).toFixed(1) : '0.0'}x ROAS</div>
                    </div>
                    <button className="mof-item-x" onClick={() => handleMarketingDelete(adSpendApi, r.id)}>×</button>
                  </div>
                ))}
              </section>
            </>
          )}

          {marketingSub === 'email' && (
            <>
              <form
                className="pform"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!emailDraft.campaign.trim()) return
                  handleMarketingAdd(emailCampaignsApi, emailDraft, setEmailDraft, ['open_rate', 'click_rate'])
                }}
              >
                <div className="pform-head"><h3 className="display">Log a campaign</h3></div>
                <div className="pf-grid">
                  <label className="pf-field">
                    <span className="mono">CAMPAIGN</span>
                    <input value={emailDraft.campaign} onChange={(e) => setEmailDraft({ ...emailDraft, campaign: e.target.value })} placeholder="Drop 02 launch" />
                  </label>
                  <label className="pf-field">
                    <span className="mono">OPEN %</span>
                    <input type="number" value={emailDraft.open_rate} onChange={(e) => setEmailDraft({ ...emailDraft, open_rate: e.target.value })} />
                  </label>
                  <label className="pf-field">
                    <span className="mono">CLICK %</span>
                    <input type="number" value={emailDraft.click_rate} onChange={(e) => setEmailDraft({ ...emailDraft, click_rate: e.target.value })} />
                  </label>
                </div>
                <button type="submit" className="mof-submit mono" disabled={marketingBusy === emailCampaignsApi}>
                  {marketingBusy === emailCampaignsApi ? 'Saving…' : 'Add row'}
                </button>
              </form>

              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>EMAIL CAMPAIGNS</div>
                {emailCampaigns.length === 0 && <div className="empty mono">Nothing logged yet.</div>}
                {emailCampaigns.map((r) => (
                  <div className="mini-row" key={r.id}>
                    <div className="mini-name">{r.campaign}</div>
                    <div className="mini-right">
                      <div className="mono">{r.open_rate}% open</div>
                      <div className="mono dim">{r.click_rate}% click</div>
                    </div>
                    <button className="mof-item-x" onClick={() => handleMarketingDelete(emailCampaignsApi, r.id)}>×</button>
                  </div>
                ))}
              </section>
            </>
          )}

          {marketingSub === 'social' && (
            <>
              <form
                className="pform"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!socialDraft.platform.trim()) return
                  handleMarketingAdd(socialStatsApi, socialDraft, setSocialDraft, ['followers', 'engagement_rate'])
                }}
              >
                <div className="pform-head"><h3 className="display">Log a platform</h3></div>
                <div className="pf-grid">
                  <label className="pf-field">
                    <span className="mono">PLATFORM</span>
                    <input value={socialDraft.platform} onChange={(e) => setSocialDraft({ ...socialDraft, platform: e.target.value })} placeholder="Instagram, Facebook…" />
                  </label>
                  <label className="pf-field">
                    <span className="mono">FOLLOWERS</span>
                    <input type="number" value={socialDraft.followers} onChange={(e) => setSocialDraft({ ...socialDraft, followers: e.target.value })} />
                  </label>
                  <label className="pf-field">
                    <span className="mono">ENGAGEMENT %</span>
                    <input type="number" value={socialDraft.engagement_rate} onChange={(e) => setSocialDraft({ ...socialDraft, engagement_rate: e.target.value })} />
                  </label>
                </div>
                <button type="submit" className="mof-submit mono" disabled={marketingBusy === socialStatsApi}>
                  {marketingBusy === socialStatsApi ? 'Saving…' : 'Add row'}
                </button>
              </form>

              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>SOCIAL TRACKING</div>
                {socialStats.length === 0 && <div className="empty mono">Nothing logged yet.</div>}
                {socialStats.map((r) => (
                  <div className="mini-row" key={r.id}>
                    <div className="mini-name">{r.platform}</div>
                    <div className="mini-right">
                      <div className="mono">{Number(r.followers).toLocaleString()} followers</div>
                      <div className="mono dim">{r.engagement_rate}% engagement</div>
                    </div>
                    <button className="mof-item-x" onClick={() => handleMarketingDelete(socialStatsApi, r.id)}>×</button>
                  </div>
                ))}
              </section>
            </>
          )}

          {marketingSub === 'coupons' && (
            <>
              <form
                className="pform"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!couponDraft.code.trim()) return
                  handleMarketingAdd(couponStatsApi, couponDraft, setCouponDraft, ['uses', 'revenue'])
                }}
              >
                <div className="pform-head"><h3 className="display">Log a coupon</h3></div>
                <div className="pf-grid">
                  <label className="pf-field">
                    <span className="mono">CODE</span>
                    <input value={couponDraft.code} onChange={(e) => setCouponDraft({ ...couponDraft, code: e.target.value.toUpperCase() })} placeholder="SUNDAY10" />
                  </label>
                  <label className="pf-field">
                    <span className="mono">USES</span>
                    <input type="number" value={couponDraft.uses} onChange={(e) => setCouponDraft({ ...couponDraft, uses: e.target.value })} />
                  </label>
                  <label className="pf-field">
                    <span className="mono">REVENUE (৳)</span>
                    <input type="number" value={couponDraft.revenue} onChange={(e) => setCouponDraft({ ...couponDraft, revenue: e.target.value })} />
                  </label>
                </div>
                <button type="submit" className="mof-submit mono" disabled={marketingBusy === couponStatsApi}>
                  {marketingBusy === couponStatsApi ? 'Saving…' : 'Add row'}
                </button>
              </form>

              <section className="panel">
                <div className="panel-label mono" style={{ marginBottom: '18px' }}>COUPONS</div>
                {couponStats.length === 0 && <div className="empty mono">Nothing logged yet.</div>}
                {couponStats.map((r) => (
                  <div className="mini-row" key={r.id}>
                    <div className="mini-name">{r.code}</div>
                    <div className="mini-right">
                      <div className="mono">{r.uses} uses</div>
                      <div className="mono dim">{taka(r.revenue)}</div>
                    </div>
                    <button className="mof-item-x" onClick={() => handleMarketingDelete(couponStatsApi, r.id)}>×</button>
                  </div>
                ))}
              </section>
            </>
          )}

          {marketingSub === 'links' && <LinkGenerator products={products} />}
          </>
        )}

        {!loading && tab === 'analytics' && (
          <>
          <div className="subtabs mono">
            {ANALYTICS_SUBS.map((s) => (
              <button
                key={s.key}
                className={`subtab ${analyticsSub === s.key ? 'active' : ''}`}
                onClick={() => setAnalyticsSub(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {analyticsSub === 'traffic' && (
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '6px' }}>VISITOR TRAFFIC</div>
            <div className="panel-note" style={{ marginBottom: '18px' }}>
              Site visits and bounce rate, last 30 days. Logged by the storefront itself.
            </div>
            {traffic.length === 0 && <div className="empty mono">No visits logged yet.</div>}
            {traffic.map((r) => (
              <div className="mini-row" key={r.page}>
                <div className="mini-name">{r.page}</div>
                <div className="mini-right">
                  <div className="mono">{r.visits} visit{r.visits === 1 ? '' : 's'}</div>
                  <div className="mono dim">{r.bounceRate.toFixed(0)}% bounce</div>
                </div>
              </div>
            ))}
          </section>
          )}

          {analyticsSub === 'conversion' && (
          <div className="stat-row three">
            <StatCard icon={<IconBox />} label="VISITORS (14 DAYS)" value={conversion.visitors} />
            <StatCard icon={<IconTag />} label="ORDERS (14 DAYS)" value={conversion.orders} />
            <StatCard icon={<IconCash />} tone="good" label="CONVERSION RATE" value={`${conversion.rate.toFixed(2)}%`} />
          </div>
          )}

          {analyticsSub === 'location' && (
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '18px' }}>HIGHEST-SELLING DISTRICTS</div>
            {byDistrict.length === 0 && <div className="empty mono">No orders yet.</div>}
            <RankBars rows={byDistrict} empty="No orders yet." accent="cobalt" countKey="orders" countLabel="orders" />
          </section>
          )}

          {analyticsSub === 'category' && (
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '18px' }}>SOLD BY CATEGORY</div>
            <RankBars rows={byCategory} empty="No category has sold anything yet." accent="cobalt" />
          </section>
          )}
          </>
        )}
        {tab === 'about' && <AboutManager />}
      </div>
      </main>

      {slipOrder && <PackingSlip order={slipOrder} />}
    </div>
  )
}
