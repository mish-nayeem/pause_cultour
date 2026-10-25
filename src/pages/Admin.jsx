import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  getSession,
  signOut,
  fetchOrders,
  fetchAdminProducts,
  updateOrderStatus,
  rejectOrderItem,
  orderMoney,
  setReturnFeePaid,
  COD_FEE_RATE,
  computeStats,
  dailySeries,
  monthlySeries,
  salesByAttribution,
  topProducts,
  customerIndex,
  lookupCustomer,
  fetchReturns,
  fetchAbandonedCarts,
  fetchBlockedAttempts,
  repeatVsNew,
  costAndMargin,
  fetchAllReviews,
  adSpendApi,
  emailCampaignsApi,
  socialStatsApi,
} from '../lib/admin.js'
import { sendStatusUpdate, sendRestockAlert } from '../lib/email.js'
import { imgUrl } from '../lib/images.js'
import ImageMigration from '../components/ImageMigration.jsx'
import BkashCheck from '../components/BkashCheck.jsx'
import CouponManager from '../components/CouponManager.jsx'
import SaleManager from '../components/SaleManager.jsx'
import AdsRoas from '../components/AdsRoas.jsx'
import EmailCampaigns from '../components/EmailCampaigns.jsx'
import SocialTracking from '../components/SocialTracking.jsx'
import MarketingGuide from '../components/MarketingGuide.jsx'
import PromoManager from '../components/PromoManager.jsx'
import InstallAppButton from '../components/InstallAppButton.jsx'
import NotifyButton from '../components/NotifyButton.jsx'
import { startAdminApp } from '../lib/adminApp.js'
import ProductForm from '../components/ProductForm.jsx'
import { collectLabels, lastLabels } from '../lib/details.js'
import HeroManager from '../components/HeroManager.jsx'
import TickerManager from '../components/TickerManager.jsx'
import LookbookManager from '../components/LookbookManager.jsx'
import CollectionManager from '../components/CollectionManager.jsx'
import DropReport from '../components/DropReport.jsx'
import CategoryManager from '../components/CategoryManager.jsx'
import AboutManager from '../components/AboutManager.jsx'
import LinkGenerator from '../components/LinkGenerator.jsx'
import AudienceManager from '../components/AudienceManager.jsx'
import ManualOrderForm from '../components/ManualOrderForm.jsx'
import useDragList from '../lib/useDragList.js'
import useAdminHistory from '../lib/useAdminHistory.js'
import { supabase } from '../lib/supabaseClient.js'
import { queueOrder, saveQueueOrder } from '../lib/products.js'
import { fetchAllNavCategories, DROPS_MENU } from '../lib/navCategories.js'
import { dropKey } from '../lib/lookbook.js'
import { isScheduled, launchLabel } from '../lib/schedule.js'
import { stockMap, totalStock, LOW_STOCK_AT, starSizes } from '../lib/stock.js'
import RestockStar from '../components/RestockStar.jsx'
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
import { SupportPages, SupportPortal } from '../components/SupportManager.jsx'
import ReturnsManager from '../components/ReturnsManager.jsx'
import AnalyticsManager from '../components/AnalyticsManager.jsx'
import { isNewRequest } from '../lib/support.js'
import NoticeCenter from '../components/NoticeCenter.jsx'
import TodayPanel from '../components/TodayPanel.jsx'
import CommandSearch from '../components/CommandSearch.jsx'
import CourierSetup from '../components/CourierSetup.jsx'
import BulkBar from '../components/BulkBar.jsx'
import AccountsManager from '../components/AccountsManager.jsx'
import InvestorReport from '../components/InvestorReport.jsx'
import DropProfit from '../components/DropProfit.jsx'
import { KeyStats, SalesTrend, OrderSources } from '../components/OverviewCharts.jsx'
import InfoTip from '../components/InfoTip.jsx'
import './admin.css'
import './admin-theme.css'
import './admin-mobile.css'

// returned: the courier brought the parcel back — the customer couldn't be
// reached or refused it. Stock goes back, like a cancel.
const STATUSES = ['pending', 'shipped', 'delivered', 'returned', 'cancelled']

// The storefront's own pages, grouped under one sidebar entry ("Website")
// with a tab each — every one works exactly as it did on its own.
const SITE_TABS = [
  { key: 'hero', label: 'Homepage' },
  { key: 'lookbook', label: 'Lookbook' },
  { key: 'menu', label: 'Nav menus' },
  { key: 'about', label: 'About us' },
  { key: 'banners', label: 'Banners' },
]
const SITE_KEYS = SITE_TABS.map((t) => t.key)

const TAB_LABELS = {
  overview: 'Overview',
  orders: 'Orders',
  products: 'Products / Inventory',
  customers: 'Customers',
  marketing: 'Marketing',
  analytics: 'Analytics',
  hero: 'Homepage hero',
  lookbook: 'Lookbook',
  menu: 'Nav menus',
  about: 'About us page',
  banners: 'Banners',
  support: 'Support',
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
  site: '#3DDC97',
  lookbook: '#7C6CFF',
  menu: '#FFC14D',
  about: '#FF5E7E',
  banners: '#FFC14D',
  support: '#3FC1FF',
}

const OVERVIEW_SUBS = [
  { key: 'today', label: 'Today' },
  { key: 'stats', label: 'Key stats' },
  { key: 'trend', label: 'Sales trend' },
  { key: 'recent', label: 'Order sources' },
]

const ORDERS_SUBS = [
  { key: 'list', label: 'Order list' },
  { key: 'bkash', label: 'bKash check' },
  { key: 'abandoned', label: 'Abandoned cart' },
  { key: 'security', label: 'Security' },
  { key: 'courier', label: 'Courier setup' },
]

const PRODUCTS_SUBS = [
  { key: 'catalog', label: 'Product catalog' },
  { key: 'stock', label: 'Stock levels' },
  { key: 'best', label: 'Best sellers' },
  { key: 'drops', label: 'Stock & sales' },
  { key: 'margin', label: 'Cost & margin' },
  { key: 'collections', label: 'Collections' },
]

const CUSTOMERS_SUBS = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'repeat', label: 'Repeat vs new' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'wishlist', label: 'Wishlist' },
]

const MARKETING_SUBS = [
  { key: 'audience', label: 'Customers & emails' },
  { key: 'adspend', label: 'Ad spend / ROAS' },
  { key: 'email', label: 'Email campaigns' },
  { key: 'social', label: 'Social tracking' },
  { key: 'sales', label: 'Sales' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'links', label: 'Tracked links' },
  { key: 'setup', label: 'Setup guide' },
]

const SUPPORT_SUBS = [
  { key: 'requests', label: 'Returns & exchanges' },
  { key: 'pages', label: 'Support pages' },
  { key: 'portal', label: 'Return portal' },
]

const ANALYTICS_SUBS = [
  { key: 'summary', label: 'Summary' },
  { key: 'products', label: 'Products' },
  { key: 'sources', label: 'Where from' },
  { key: 'timing', label: 'Best times' },
  { key: 'location', label: 'Districts' },
  { key: 'pages', label: 'Pages' },
  { key: 'report', label: 'Investor report' },
]

// The three looks the panel can wear — see admin-theme.css. The pick is kept in
// this browser, so it survives a reload without touching the database.
const THEMES = [
  { key: 'green', label: 'Green & white' },
  { key: 'blue', label: 'Blue & white' },
  { key: 'dark', label: 'Black & grey' },
  { key: 'orange', label: 'Black & orange' },
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

// "09:24 pm · 19 Oct" — an order card's time and date.
function orderWhen(iso) {
  const d = new Date(iso)
  return `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })} · ${shortDate(iso)}`
}

// An order's details open over the list — a panel from the right on a
// desktop, a sheet from the bottom on a phone — so the orders under it don't
// get pushed down the page. Esc or a tap outside closes it.
function OrderSheetFrame({ onClose, children }) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') close.current()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="osheet-overlay" onClick={onClose}>
      <aside className="osheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} data-lenis-prevent>
        {children}
      </aside>
    </div>
  )
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
function StatCard({ icon, tone, label, value, note, onClick, cta, tip }) {
  const body = (
    <>
      <div className="stat-top">
        <span className={`stat-ico ${tone || ''}`}>{icon}</span>
        <div className="stat-label mono">{label}</div>
        {tip && <span onClick={(e) => e.stopPropagation()}><InfoTip>{tip}</InfoTip></span>}
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
            {Number(order.discount_amount) > 0 && (
              <tr>
                <td>Discount · {order.coupon_code}</td>
                <td className="right">− {taka(order.discount_amount)}</td>
              </tr>
            )}
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
  )
}

export default function Admin() {
  const [session, setSession] = useState(null)
  // Installable as PAUSE Admin while this page is open (src/lib/adminApp.js).
  useEffect(() => startAdminApp(), [])
  const [theme, setTheme] = useState(savedTheme)
  const [checkingAuth, setCheckingAuth] = useState(true)

  const [tab, setTab] = useState('overview')
  // Website: the tab it opens on — the last one used.
  const [lastSiteTab, setLastSiteTab] = useState('hero')
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [navCategories, setNavCategories] = useState([])
  const [wishRows, setWishRows] = useState([])
  const [notifying, setNotifying] = useState(null)
  const [courierBusy, setCourierBusy] = useState(null)
  const [courierPick, setCourierPick] = useState({})
  // The orders whose packing slips are printing — one, or several from
  // Select, each on its own page.
  const [slips, setSlips] = useState(null)
  // Search-everything (header button, Ctrl+K or /).
  const [searchOpen, setSearchOpen] = useState(false)
  // Orders → Select: ticking cards to act on many at once.
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState('')
  const [bulkNote, setBulkNote] = useState('')
  // ✕ on an order's item: the line asking "returned at the door?" and the
  // one being saved.
  const [rejectAsk, setRejectAsk] = useState(null)
  const [rejectBusy, setRejectBusy] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [monthMetric, setMonthMetric] = useState('units')
  const [editing, setEditing] = useState(null) // null | 'new' | product row
  // "+ Add another colour": the product the new colour is copied from.
  const [copyFrom, setCopyFrom] = useState(null)
  // Products → Collections: the collection open, and the one a new product
  // is being added to (prefills its Drop).
  const [openCollection, setOpenCollection] = useState(null)
  const [newProductDrop, setNewProductDrop] = useState('')
  // A product added to a collection whose launch is scheduled starts with
  // the same launch time.
  const [newProductLaunch, setNewProductLaunch] = useState('')
  const [addingOrder, setAddingOrder] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [overviewSub, setOverviewSub] = useState('today')
  const [ordersSub, setOrdersSub] = useState('list')
  const [returns, setReturns] = useState([])
  const [abandonedCarts, setAbandonedCarts] = useState([])
  const [blockedAttempts, setBlockedAttempts] = useState([])
  const [analyticsSub, setAnalyticsSub] = useState('summary')
  const [supportSub, setSupportSub] = useState('requests')
  const [productsSub, setProductsSub] = useState('catalog')
  // Products → Cost & margin: per product, or a drop's profit.
  const [marginView, setMarginView] = useState('product')
  const [customersSub, setCustomersSub] = useState('accounts')
  const [allReviews, setAllReviews] = useState([])
  const [marketingSub, setMarketingSub] = useState('audience')
  const [adSpend, setAdSpend] = useState([])
  const [emailCampaigns, setEmailCampaigns] = useState([])
  const [socialStats, setSocialStats] = useState([])

  // Every section, sub-tab and open form is a step in the browser history, so
  // the phone's Back button walks back through the panel instead of leaving it.
  const panelHistory = useAdminHistory(
    {
      tab,
      overviewSub,
      ordersSub,
      productsSub,
      customersSub,
      marketingSub,
      analyticsSub,
      supportSub,
      editing: editing === 'new' ? 'new' : editing?.id ?? null,
      addingOrder,
      openCollection,
      expanded,
    },
    (v) => {
      setTab(v.tab)
      setOverviewSub(v.overviewSub)
      setOrdersSub(v.ordersSub)
      setProductsSub(v.productsSub)
      setCustomersSub(v.customersSub)
      setMarketingSub(v.marketingSub)
      setAnalyticsSub(v.analyticsSub)
      setSupportSub(v.supportSub)
      setEditing(v.editing === 'new' ? 'new' : v.editing ? products.find((p) => p.id === v.editing) || null : null)
      setAddingOrder(v.addingOrder)
      setOpenCollection(v.openCollection)
      setExpanded(v.expanded ?? null)
      // The drawer isn't a step of its own; going back just closes it.
      setMobileMenuOpen(false)
    }
  )

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

    const [o, p, c, w, r, ac, rv, as, ec, ss, ba] = await Promise.all([
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
    setBlockedAttempts(ba.attempts)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!session) return
    reload()
  }, [session, reload])

  // New orders without a reload: the lists that change on their own
  // (orders, returns, abandoned carts) are fetched again quietly — no
  // loading screen — every minute while the admin is on screen, the moment
  // it's opened again (the installed app has no refresh), and when a
  // notification arrives. Products and the rest only change from here.
  const [refreshing, setRefreshing] = useState(false)
  const lastRefresh = useRef(0)
  const refreshLive = useCallback(async () => {
    lastRefresh.current = Date.now()
    setRefreshing(true)
    const [o, r, ac] = await Promise.all([fetchOrders(), fetchReturns(), fetchAbandonedCarts()])
    setRefreshing(false)
    if (!o.error) setOrders(o.orders)
    if (!r.error) setReturns(r.returns)
    if (!ac.error) setAbandonedCarts(ac.carts)
  }, [])

  useEffect(() => {
    if (!session) return
    lastRefresh.current = Date.now()
    const soon = () => { if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 10_000) refreshLive() }
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refreshLive() }, 60_000)
    document.addEventListener('visibilitychange', soon)
    window.addEventListener('focus', soon)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', soon)
      window.removeEventListener('focus', soon)
    }
  }, [session, refreshLive])


  const stats = useMemo(() => computeStats(orders), [orders])
  const series = useMemo(() => dailySeries(orders, 14), [orders])
  const months = useMemo(() => monthlySeries(orders, 6), [orders])
  const byAttribution = useMemo(() => salesByAttribution(orders), [orders])
  const top = useMemo(() => topProducts(orders, 5), [orders])
  const demand = useMemo(() => groupDemand(wishRows), [wishRows])
  const customers = useMemo(() => customerIndex(orders), [orders])
  const custSplit = useMemo(() => repeatVsNew(orders), [orders])
  const margins = useMemo(() => costAndMargin(products), [products])

  // One row per product, every size's count sitting side by side — same
  // stock-chips a product's catalog row already shows, just without the rest
  // of the columns. An untracked product (no stock map at all) has no
  // quantity to show, so it's left out rather than shown blank.
  const trackedProducts = useMemo(() => products.filter((p) => stockMap(p) !== null), [products])

  // The names already in use plus the ones on the shop menu, so a product can
  // be filed under a menu category that has nothing in it yet — the spellings
  // have to match exactly for the menu to find the product.
  // Collection (drop) names for the product form: the DROPS menu's rows plus
  // any drop a product already carries, one per name however it's spelt.
  const [menuDrops, setMenuDrops] = useState([])
  useEffect(() => {
    if (!editing) return
    fetchAllNavCategories(DROPS_MENU).then(({ categories }) => setMenuDrops(categories.map((c) => c.label)))
  }, [editing])
  const collectionNames = useMemo(() => {
    const seen = new Map()
    for (const n of [...menuDrops, ...products.map((p) => p.drop_name)]) {
      if (n && n.trim() && !seen.has(dropKey(n))) seen.set(dropKey(n), n.trim())
    }
    return [...seen.values()]
  }, [menuDrops, products])

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

  // Product catalog = the shop's ALL page, top to bottom. Dragging a row by
  // its handle changes that order; categories stay newest upload first.
  const queue = useMemo(() => queueOrder(products), [products])
  const [queueError, setQueueError] = useState('')
  const drag = useDragList(queue, async (ids) => {
    setQueueError('')
    const at = new Map(ids.map((id, i) => [id, i + 1]))
    setProducts((prev) => prev.map((p) => ({ ...p, shop_position: at.get(p.id) ?? p.shop_position })))
    const { error } = await saveQueueOrder(ids)
    if (error) {
      setQueueError("Couldn't save the order — has supabase-migration-shop-order.sql been run?")
      reload()
    }
  })

  const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products])
  const expandedOrder = useMemo(() => orders.find((o) => o.id === expanded) || null, [orders, expanded])

  // Delivered: where the money went — the courier's cut and what's ours.
  // Returned: the delivery charge, Paid / Unpaid.
  function renderMoneySplit(o) {
    const m = orderMoney(o)
    if (o.status === 'delivered' || m.expected) {
      return (
        <div className="osplit">
          <div className="osplit-head mono">
            AFTER THE COURIER
            <InfoTip>
              <p>The courier keeps the delivery charge and {Math.round(COD_FEE_RATE * 100)}% of the product price it collects.</p>
              <p><b>Receivable amount</b> = product price − {Math.round(COD_FEE_RATE * 100)}%: what reaches you. {m.expected ? 'It is added to Revenue once this order is delivered.' : 'This order is delivered, so it is in Revenue.'}</p>
            </InfoTip>
          </div>
          <div className="orow dim"><span>Courier · delivery</span><span className="mono">− {taka(m.delivery)}</span></div>
          <div className="orow dim"><span>Courier · {Math.round(COD_FEE_RATE * 100)}% of {taka(m.collected ?? m.items)}</span><span className="mono">− {taka(m.codFee)}</span></div>
          {m.exchange > 0 && (
            <div className="orow dim">
              <span title="The exchange parcel or the return pickup">Courier · 2nd parcel {taka(m.exchange)} · {m.exchangeUnpaid ? 'paid by us' : 'customer paid'}</span>
              <span className="mono">− {taka(m.exchangeUnpaid)}</span>
            </div>
          )}
          <div className="orow osplit-you">
            <span>Receivable amount{m.expected ? ' · after delivery' : ' · in revenue'}</span>
            <span className="mono">{m.receivable < 0 ? `− ${taka(-m.receivable)}` : taka(m.receivable)}</span>
          </div>
        </div>
      )
    }
    if (o.status === 'returned') {
      const paid = m.returnFeePaid
      return (
        <div className="osplit">
          <div className="osplit-head mono">
            RETURN DELIVERY CHARGE · {taka(m.delivery)}
            <InfoTip>
              <p>The courier charges the delivery even when the parcel comes back.</p>
              <p><b>Paid</b> — the customer paid it (or the bKash advance covered it): nothing comes off your revenue.</p>
              <p><b>Unpaid</b> — they didn't: {taka(m.delivery)} comes off your revenue.</p>
            </InfoTip>
          </div>
          <div className="osplit-pick mono" role="radiogroup" aria-label="Return delivery charge">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={paid === v}
                className={`osplit-opt ${paid === v ? 'on' : ''} ${v ? 'paid' : 'unpaid'}`}
                disabled={savingId === o.id}
                onClick={async () => {
                  if (paid === v) return
                  setSavingId(o.id)
                  const { error } = await setReturnFeePaid(o.id, v)
                  setSavingId(null)
                  if (error) setLoadError(error)
                  else setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, return_fee_paid: v } : x)))
                }}
              >
                {v ? 'Paid' : 'Unpaid'}
              </button>
            ))}
          </div>
          <div className="orow osplit-you">
            <span>Your revenue</span>
            <span className="mono">{m.toShop < 0 ? `− ${taka(-m.toShop)}` : taka(0)}</span>
          </div>
        </div>
      )
    }
    return null
  }

  // The open order's details, in sections: the pieces, the money, who and
  // where, this number's history, courier, and what to do next.
  function renderOrderSheet(o) {
    const h = lookupCustomer(customers, o.customer_phone)
    const history = returns.filter((r) => r.order_id === o.id && r.resolution && r.resolution.action !== 'reject')
    const advance = Number(o.advance_amount) || 0
    return (
      <>
        <header className="osheet-head">
          <div>
            <div className="osheet-id mono">{o.id}</div>
            <div className="osheet-name">{o.customer_name}</div>
            <div className="osheet-when mono">{orderWhen(o.created_at)}</div>
          </div>
          <div className="osheet-head-right">
            <select
              className={`status-select ${o.status} mono`}
              value={o.status}
              disabled={savingId === o.id}
              onChange={(e) => handleStatusChange(o.id, e.target.value)}
            >
              {STATUSES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            <button type="button" className="osheet-close" onClick={() => setExpanded(null)} aria-label="Close">✕</button>
          </div>
        </header>

        <section className="osec">
          <div className="osec-label mono">
            ITEMS · {(o.order_items || []).reduce((n, it) => n + Number(it.ordered_qty ?? it.qty), 0)} pcs{' '}
            <InfoTip>
              <p><b>✕ on an item</b> — the customer kept the rest but handed this one back to the rider. It goes back into stock, comes off the cash to collect and stops counting as sold. Then set the order to <b>delivered</b> for the rest.</p>
              <p>Tap ✕ again (Undo) if it was a mistake.</p>
              <p>Whole parcel came back (couldn't reach the customer, or refused)? Set the status to <b>returned</b> instead — every piece goes back into stock.</p>
            </InfoTip>
          </div>
          {(o.order_items || []).map((it) => {
            const ordered = it.ordered_qty ?? it.qty
            const door = Number(it.rejected_qty) || 0
            const refundedBack = Number(it.returned_qty) || 0
            const src = productsById.get(String(it.product_id))?.images?.[0]
            const canCross = !['cancelled', 'returned'].includes(o.status)
            return (
              <div className={`oitem ${door ? 'crossed' : ''}`} key={it.id}>
                <span className="oitem-thumb">{src && <img src={imgUrl(src, { w: 100 })} alt="" />}</span>
                <span className="oitem-name">
                  {it.product_name}
                  <span className="mono dim">
                    {' '}· {it.size} × {ordered}
                    {it.exchanged_from && <span className="ditem-swap"> · exchanged from {it.exchanged_from}</span>}
                    {refundedBack > 0 && <span className="ditem-back"> · {refundedBack} refunded</span>}
                    {door > 0 && <span className="ditem-back"> · returned at door, back in stock</span>}
                  </span>
                  {rejectAsk === it.id && (
                    <span className="oitem-ask mono">
                      {door ? 'Undo — this piece was delivered after all?' : 'Customer handed this back to the rider?'}
                      <button
                        type="button"
                        className="ab-yes"
                        disabled={rejectBusy === it.id}
                        onClick={async () => {
                          setRejectBusy(it.id)
                          const { error } = await rejectOrderItem(it.id, door > 0)
                          setRejectBusy(null)
                          setRejectAsk(null)
                          if (error) setLoadError(error)
                          else reload()
                        }}
                      >
                        {rejectBusy === it.id ? '…' : 'Yes'}
                      </button>
                      <button type="button" className="ab-no" onClick={() => setRejectAsk(null)}>No</button>
                    </span>
                  )}
                </span>
                <span className="mono oitem-price">{taka(it.price * ordered)}</span>
                {canCross && (
                  <button
                    type="button"
                    className={`oitem-x ${door ? 'on' : ''}`}
                    title={door ? 'Undo — put it back on the order' : 'Returned at the door — back into stock'}
                    aria-label={door ? `Undo return of ${it.product_name}` : `${it.product_name} returned at the door`}
                    onClick={() => setRejectAsk(rejectAsk === it.id ? null : it.id)}
                  >
                    {door ? '↺' : '✕'}
                  </button>
                )}
              </div>
            )
          })}
          {(!o.order_items || o.order_items.length === 0) && <div className="mono dim">No line items recorded.</div>}
          {history.map((r) => (
            <div className="ditem-history mono" key={r.id}>
              {r.resolution.action === 'exchange'
                ? `Exchanged ${(r.resolution.items || []).map((x) => `${x.product_name} ${x.from_size} → ${x.to_size} ×${x.qty}`).join(', ')}`
                : `Refunded ${taka(r.resolution.refund)} · ${(r.resolution.items || []).map((x) => `${x.product_name} ${x.size} ×${x.qty}`).join(', ')} back in stock`}
              {' · '}{shortDate(r.resolution.at || r.processed_at)}
            </div>
          ))}
        </section>

        <section className="osec">
          <div className="osec-label mono">PAYMENT</div>
          <div className="orow"><span>Items</span><span className="mono">{taka(o.paid_subtotal ?? o.subtotal)}</span></div>
          {Number(o.discount_amount) > 0 && (
            <div className="orow">
              <span>Discount · <span className="mono">{o.coupon_code}</span></span>
              <span className="mono">− {taka(o.discount_amount)}</span>
            </div>
          )}
          {/* Keyed off the zone, not the fee: orders from before delivery
              charges carry a 0 fee and would show a free delivery line. */}
          {o.delivery_zone && (
            <div className="orow">
              <span>Delivery · {o.delivery_zone === 'inside' ? 'Inside' : 'Outside'} Dhaka</span>
              <span className="mono">{taka(o.delivery_fee ?? 0)}</span>
            </div>
          )}
          {advance > 0 && (
            <div className="orow">
              <span>Advance · bKash <span className="mono trx">{o.advance_trx_id}</span></span>
              <span className="mono">− {taka(advance)}</span>
            </div>
          )}
          {o.rejected_value > 0 && (
            <div className="orow ditem-refund"><span>Returned at door</span><span className="mono">− {taka(o.rejected_value)}</span></div>
          )}
          {o.refunded > 0 && (
            <div className="orow ditem-refund"><span>Refunded</span><span className="mono">− {taka(o.refunded)}</span></div>
          )}
          <div className="orow ototal">
            <span>{advance > 0 ? 'Cash to collect' : 'Total (COD)'}</span>
            <span className="mono">{taka((o.paid_total ?? o.total ?? o.subtotal) - (o.rejected_value || 0) - advance)}</span>
          </div>
          {renderMoneySplit(o)}
        </section>

        <section className="osec">
          <div className="osec-label mono">CUSTOMER &amp; DELIVERY</div>
          <div className="orow"><span className="dim">Name</span><span>{o.customer_name}</span></div>
          <div className="orow">
            <span className="dim">Phone</span>
            <span className="mono">
              <a href={`tel:${o.customer_phone}`}>{o.customer_phone}</a>
            </span>
          </div>
          {o.customer_email && <div className="orow"><span className="dim">Email</span><span className="mono oemail">{o.customer_email}</span></div>}
          <div className="oaddr">
            <span className="dim">Address</span>
            <span>{o.customer_address}</span>
            <span className="mono dim">{o.customer_area}</span>
          </div>
          {o.customer_note && (
            <div className="oaddr">
              <span className="dim">Note</span>
              <span>{o.customer_note}</span>
            </div>
          )}
        </section>

        {/* Everything this phone number has done with us, so the confirmation
            call can be made knowing whether the last parcels came back. */}
        <section className="osec">
          <div className="osec-label mono">THIS NUMBER</div>
          {h.level === 'new' ? (
            <div className="hist mono">First order from this number.</div>
          ) : (
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
          )}
          {o.utm_source && (
            <div className="orow" style={{ marginTop: '8px' }}>
              <span className="dim">Came from</span>
              <span className="mono">{[o.utm_source, o.utm_medium, o.utm_campaign].filter(Boolean).join(' · ')}</span>
            </div>
          )}
        </section>

        <section className="osec">
          <div className="osec-label mono">
            COURIER{' '}
            <InfoTip>
              <p>Pick a courier and Send — the parcel is booked and its tracking number lands here. Sync status asks where it is now.</p>
              <p>Not working yet? Orders → Courier setup shows which keys to add.</p>
            </InfoTip>
          </div>
          {o.consignment_id ? (
            <>
              <div className="orow">
                <span>{courierLabel(o.courier)}</span>
                <span className="mono">{o.consignment_id}</span>
              </div>
              <div className="courier-row">
                <span className="mono dim">
                  {o.courier_status || 'booked'}
                  {o.courier_synced_at && ` · synced ${shortDate(o.courier_synced_at)}`}
                </span>
                <button className="courier-btn ghost mono" disabled={courierBusy === o.id} onClick={() => handleCourierSync(o)}>
                  {courierBusy === o.id ? 'Checking…' : 'Sync status'}
                </button>
              </div>
            </>
          ) : (
            <div className="courier-row">
              <select
                className="courier-select mono"
                value={courierPick[o.id] || COURIERS[0].key}
                onChange={(e) => setCourierPick({ ...courierPick, [o.id]: e.target.value })}
              >
                {COURIERS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              <button className="courier-btn mono" disabled={courierBusy === o.id} onClick={() => handleCourierSend(o)}>
                {courierBusy === o.id ? 'Sending…' : 'Send to courier'}
              </button>
            </div>
          )}
        </section>

        <div className="osheet-actions">
          <a className="wa-btn" href={whatsappLink(o.customer_phone, shopToCustomerMessage(o))} target="_blank" rel="noreferrer">
            <IconChat width="15" height="15" />
            WhatsApp customer
          </a>
          <button className="courier-btn ghost mono" onClick={() => setSlips([o])}>Print packing slip</button>
        </div>
      </>
    )
  }

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
    if (SITE_KEYS.includes(key)) setLastSiteTab(key)
    setTab(key)
    setMobileMenuOpen(false)
  }

  // Every counter on the overview is a way into the orders behind it — the
  // click lands on the orders tab with that status already filtered.
  function openOrders(status) {
    setOrdersSub('list')
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

  // Deletes an old typed row (ad spend, email, social), then reloads.
  async function handleMarketingDelete(api, id) {
    await api.remove(id)
    reload()
  }

  // Rendered, printed, then dropped once the dialog closes. Waiting for
  // afterprint rather than clearing straight away keeps the slip on the page
  // for the browsers that print asynchronously.
  useEffect(() => {
    if (!slips?.length) return

    // Chrome names a "Save as PDF" file after the document title, so the slip
    // saves as PC481203.pdf rather than whatever the admin tab was called.
    const previousTitle = document.title
    document.title = slips.length === 1 ? `${slips[0].id} · PAUSE packing slip` : `PAUSE packing slips · ${slips.length} orders`

    const done = () => setSlips(null)
    window.addEventListener('afterprint', done)
    window.print()

    return () => {
      window.removeEventListener('afterprint', done)
      document.title = previousTitle
    }
  }, [slips])

  // Ctrl+K / ⌘K anywhere, or / when not typing, opens the search.
  useEffect(() => {
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSearchOpen((v) => !v)
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // A tapped "New order" notification: /admin?order=PC… when the app opens on
  // it, or a message from the service worker when the admin is already open.
  // (Set to openOrder further down, once it exists.)
  const openOrderRef = useRef(null)
  const refreshLiveRef = useRef(refreshLive)
  refreshLiveRef.current = refreshLive
  useEffect(() => {
    if (loading || !session) return
    const id = new URLSearchParams(window.location.search).get('order')
    if (id) {
      openOrderRef.current?.(id)
      window.history.replaceState(null, '', '/admin')
    }
  }, [loading, session])
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e) => {
      if (e.data?.type === 'refresh') return refreshLiveRef.current?.()
      if (e.data?.type !== 'open') return
      const id = new URL(e.data.url, window.location.origin).searchParams.get('order')
      if (id) openOrderRef.current?.(id)
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

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
    returned: stats.returned,
  }

  // Refund / exchange requests customers sent from the Support page that the
  // admin hasn't opened yet — the Support badge and the Overview notice.
  const newRequests = returns.filter(isNewRequest).length

  // A notification's "Open": that order in the order list, opened up. One
  // placed since the panel loaded isn't in the list yet, so reload first.
  function openOrder(id) {
    if (!orders.some((o) => o.id === id)) reload()
    setOrdersSub('list')
    setStatusFilter('all')
    setSearch(id)
    setExpanded(id)
    setTab('orders')
  }

  openOrderRef.current = openOrder

  function openRequests() {
    setSupportSub('requests')
    goTab('support')
  }

  // ---- Orders → Select ----
  function togglePick(id) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function stopSelecting() {
    setSelecting(false)
    setPicked(new Set())
    setBulkNote('')
  }

  const pickedOrders = orders.filter((o) => picked.has(o.id))

  // One at a time, so each customer's status email goes out like a manual
  // change would, and a failure stops on the order it failed on.
  async function bulkMark(status) {
    const list = pickedOrders.filter((o) => o.status !== status)
    let done = 0
    for (const o of list) {
      setBulkBusy(`Updating ${done + 1} of ${list.length}…`)
      await handleStatusChange(o.id, status)
      done++
    }
    setBulkBusy('')
    const skipped = pickedOrders.length - list.length
    setBulkNote(`${done} marked ${status}${skipped ? ` · ${skipped} already were` : ''}.`)
  }

  async function bulkCourier(courier) {
    const list = pickedOrders.filter((o) => !o.consignment_id && o.status !== 'cancelled')
    const failed = []
    let booked = 0
    for (const o of list) {
      setBulkBusy(`Booking ${booked + failed.length + 1} of ${list.length}…`)
      const { error } = await sendToCourier(o.id, courier)
      if (error) {
        failed.push(`${o.id}: ${error}`)
        // No keys / not deployed is the same for every order — stop early.
        if (/isn.t connected|no API keys/.test(error)) break
      } else booked++
    }
    setBulkBusy('')
    const skipped = pickedOrders.length - list.length
    setBulkNote(
      [
        `${booked} booked with ${courierLabel(courier)}`,
        skipped ? `${skipped} skipped (already booked or cancelled)` : '',
        failed.length ? `${failed.length} failed:\n${failed.slice(0, 5).join('\n')}` : '',
      ].filter(Boolean).join(' · ')
    )
    if (booked) reload()
  }

  const navItems = [
    { key: 'overview', label: 'Overview', badge: null },
    { key: 'orders', label: 'Orders', badge: stats.open > 0 ? stats.open : null },
    { key: 'products', label: 'Products / Inventory', badge: null },
    { key: 'customers', label: 'Customers', badge: demand.length > 0 ? wishRows.length : null },
    { key: 'support', label: 'Support', badge: newRequests > 0 ? newRequests : null },
    { key: 'marketing', label: 'Marketing', badge: null },
    { key: 'analytics', label: 'Analytics', badge: null },
    // Homepage, Lookbook, Nav menus and About us — as tabs inside.
    { key: 'site', label: 'Website', badge: null },
  ]

  return (
    // Black & orange is the dark theme with its own colours (data-accent), so
    // every rule written for the dark theme holds for it too.
    <div className="admin" data-theme={theme === 'orange' ? 'dark' : theme} data-accent={theme === 'orange' ? 'orange' : undefined} data-tab={tab}>
      <div className="admin-topbar">
        {/* Phones: one step back inside the panel, like the phone's own Back. */}
        {panelHistory.depth > 0 && (
          <button type="button" className="admin-back" onClick={panelHistory.back} aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
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

        {/* data-lenis-prevent: the wheel scrolls the menu, not the page, while the pointer is over it. */}
        <nav className="side-nav mono" data-lenis-prevent>
          {navItems.map((item) => (
            <button
              key={item.key}
              className={tab === item.key || (item.key === 'site' && SITE_KEYS.includes(tab)) ? 'on' : ''}
              style={{ '--item-color': SECTION_COLORS[item.key] }}
              onClick={() => goTab(item.key === 'site' ? lastSiteTab : item.key)}
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
          <NotifyButton />
          <InstallAppButton />
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
              ADMIN / {SITE_KEYS.includes(tab) ? `WEBSITE / ${TAB_LABELS[tab].toUpperCase()}` : TAB_LABELS[tab].toUpperCase()}
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
              {tab === 'support' &&
                ` / ${SUPPORT_SUBS.find((s) => s.key === supportSub).label.toUpperCase()}`}
            </div>
            <h1 className="display">{SITE_KEYS.includes(tab) ? 'Website' : TAB_LABELS[tab]}</h1>
            <div className="top-sub mono">{session.user?.email}</div>
          </div>
          <div className="top-right">
            <div className="top-actions">
            <button type="button" className="top-search mono" onClick={refreshLive} disabled={refreshing} title="Check for new orders">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" className={refreshing ? 'spin' : ''}><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg>
              {refreshing ? 'Checking…' : 'Refresh'}
            </button>
            <button type="button" className="top-search mono" onClick={() => setSearchOpen(true)} title="Search orders, customers and products (Ctrl+K)">
              <IconSearch width="13" height="13" />
              Search
              <kbd>Ctrl K</kbd>
            </button>
            </div>
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
            <NoticeCenter
              orders={orders}
              returns={returns}
              onOpenOrder={openOrder}
              onOpenRequests={openRequests}
            />
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

            {overviewSub === 'today' && (
              <TodayPanel
                orders={orders}
                products={products}
                returns={returns}
                newRequests={newRequests}
                onOpenOrders={openOrders}
                onOpenOrder={openOrder}
                onOpenRequests={openRequests}
                onOpenStock={() => { setProductsSub('stock'); goTab('products') }}
              />
            )}

            {overviewSub === 'stats' && <KeyStats orders={orders} onOpenOrders={openOrders} />}

            {overviewSub === 'trend' && <SalesTrend orders={orders} products={products} />}

            {overviewSub === 'recent' && <OrderSources orders={orders} />}


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
                <button
                  className={`add-product select-toggle mono ${selecting ? 'on' : ''}`}
                  onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                >
                  {selecting ? 'Done' : 'Select'}
                </button>
                <InfoTip>
                  <p><b>Select</b> — tap order cards to tick them, then mark them shipped or delivered, print all their packing slips, or book them with a courier, in one go.</p>
                  <p>Tip: filter PENDING first, then “All” to tick every pending order.</p>
                </InfoTip>
                <button className="add-product mono" onClick={() => setAddingOrder(true)}>
                  + New order
                </button>
              </div>
            </div>

            {filteredOrders.length === 0 && <div className="empty mono">No matching orders.</div>}

            <div className={`olist ${selecting ? 'selecting' : ''}`}>
              {filteredOrders.map((o) => {
                const items = o.order_items || []
                const first = items[0]
                const risk = lookupCustomer(customers, o.customer_phone)
                return (
                  <div
                    className={`ocard ${o.status} ${expanded === o.id ? 'on' : ''} ${picked.has(o.id) ? 'picked' : ''}`}
                    key={o.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selecting ? picked.has(o.id) : undefined}
                    onClick={() => (selecting ? togglePick(o.id) : setExpanded(o.id))}
                    onKeyDown={(e) => { if (e.key === 'Enter') (selecting ? togglePick(o.id) : setExpanded(o.id)) }}
                  >
                    {selecting && <span className="ocard-tick" aria-hidden="true">{picked.has(o.id) ? '✓' : ''}</span>}
                    <div className="ocard-name">
                      {/* A long name steps down a size so it still fits in a line or two. */}
                      <span
                        className={`ocard-name-text ${
                          (o.customer_name || '').length > 30 ? 'xlong' : (o.customer_name || '').length > 20 ? 'long' : ''
                        }`}
                      >
                        {o.customer_name}
                      </span>
                      {risk.level === 'risk' && (
                        <span className="risk-tag mono">{risk.cancelled} CANCELLED</span>
                      )}
                    </div>

                    <div className="ocard-meta">
                      <span className="mono ocard-when">
                        <span>{o.id}</span>
                        <span>{orderWhen(o.created_at)}</span>
                      </span>
                      <select
                        className={`status-select ${o.status} mono`}
                        value={o.status}
                        disabled={savingId === o.id}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleStatusChange(o.id, e.target.value)}
                      >
                        {STATUSES.map((st) => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </div>

                    <div className="ocard-items">
                      <span className="ocard-thumbs">
                        {items.slice(0, 3).map((it) => {
                          const src = productsById.get(String(it.product_id))?.images?.[0]
                          return (
                            <span className="ocard-thumb" key={it.id}>
                              {src && <img src={imgUrl(src, { w: 80 })} alt="" loading="lazy" />}
                            </span>
                          )
                        })}
                      </span>
                      <span className="ocard-what">
                        {first ? `${first.product_name} · ${first.size} × ${first.ordered_qty ?? first.qty}` : 'No items'}
                        {items.length > 1 && <span className="dim"> + {items.length - 1} more</span>}
                      </span>
                    </div>

                    <div className="ocard-bottom">
                      <span className="mono ocard-phone">
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
                      </span>
                      <span className="ocard-total mono">
                        {Number(o.advance_amount) > 0 && <span className="adv-tag">ADV</span>}
                        {taka(o.total ?? o.subtotal)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {selecting && (
              <BulkBar
                count={picked.size}
                shown={filteredOrders.length}
                busy={bulkBusy}
                note={bulkNote}
                onAll={() => setPicked(new Set(filteredOrders.map((o) => o.id)))}
                onNone={() => setPicked(new Set())}
                onMark={bulkMark}
                onPrint={() => setSlips(pickedOrders)}
                onCourier={bulkCourier}
                onExit={stopSelecting}
              />
            )}

            {expandedOrder && !selecting && (
              <OrderSheetFrame onClose={() => setExpanded(null)}>
                {renderOrderSheet(expandedOrder)}
              </OrderSheetFrame>
            )}
          </section>
          )}


          {ordersSub === 'courier' && (
            <section className="panel">
              <CourierSetup />
            </section>
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

          {ordersSub === 'bkash' && (
            <BkashCheck
              orders={orders}
              onChange={(id, patch) =>
                setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
              }
            />
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
            key={copyFrom ? `copy-${copyFrom.id}` : editing === 'new' ? 'new' : editing.id}
            existing={editing === 'new' ? null : editing}
            copyFrom={editing === 'new' ? copyFrom : null}
            allProducts={products}
            existingIds={products.map((p) => p.id)}
            categories={productCategories}
            drops={collectionNames}
            initialDrop={newProductDrop}
            initialPublishAt={newProductLaunch}
            detailLabels={collectLabels(products)}
            startLabels={lastLabels(products)}
            onCancel={() => { setEditing(null); setCopyFrom(null) }}
            onDone={() => {
              setEditing(null)
              setCopyFrom(null)
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
                Click a product to edit it. Images upload straight to Supabase Storage.
              </div>
              <button className="add-product mono" onClick={() => { setCopyFrom(null); setNewProductDrop(''); setNewProductLaunch(''); setEditing('new') }}>
                + Add product
              </button>
            </div>

            <ImageMigration onDone={reload} />

            {products.length > 1 && (
              <div className="queue-note mono">
                This is the order of the shop's <strong>ALL</strong> page. Drag a product by
                the <span className="queue-grip-inline">⠿</span> handle to move it up or down.
                Category pages (hoodies, jackets…) always show the newest upload first, and a
                new upload starts at the top here too.
              </div>
            )}
            {queueError && <div className="err-banner mono">{queueError}</div>}

            {products.length === 0 && <div className="empty mono">No products in the catalog.</div>}

            <div className="table">
              {drag.list.map((p) => (
                <div
                  className={`trow prow clickable queue ${drag.dragId === p.id ? 'dragging' : ''}`}
                  key={p.id}
                  ref={drag.rowRef(p.id)}
                  onClick={() => setEditing(p)}
                >
                  <div className="pthumb">
                    {Array.isArray(p.images) && p.images[0] && <img src={imgUrl(p.images[0], { w: 120 })} alt="" />}
                    <RestockStar sizes={starSizes(p)} />
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
                    {isScheduled(p) && <span className="sched-tag">Live {launchLabel(p.publish_at)}</span>}
                    {totalStock(p) === 0 && <span className="out-tag">Sold out</span>}
                    {totalStock(p) === null &&
                      Array.isArray(p.sizes_out) &&
                      p.sizes_out.length > 0 && (
                        <span className="out-tag">{p.sizes_out.length} size out</span>
                      )}
                  </div>
                  <button
                    type="button"
                    className="drag-handle"
                    aria-label={`Drag to move ${p.name}`}
                    title="Drag to move"
                    onPointerDown={(e) => drag.start(e, p.id)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true">
                      {[3, 9, 15].map((y) => (
                        <g key={y}><circle cx="3" cy={y} r="1.6" /><circle cx="9" cy={y} r="1.6" /></g>
                      ))}
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
          )}

          {productsSub === 'collections' && (
            <CollectionManager
              products={products}
              open={openCollection}
              onOpen={setOpenCollection}
              onAddProduct={(drop, launch) => { setCopyFrom(null); setNewProductDrop(drop); setNewProductLaunch(launch || ''); setEditing('new') }}
              onEditProduct={(p) => setEditing(p)}
              onChanged={reload}
            />
          )}

          {productsSub === 'stock' && (
          <section className="panel sl-panel">
            <div className="panel-label mono" style={{ marginBottom: '6px' }}>STOCK LEVELS</div>
            <div className="sl-legend mono">
              <span className="sl-key ok">Plenty</span>
              <span className="sl-key low">Low ({LOW_STOCK_AT} or fewer)</span>
              <span className="sl-key out">Sold out</span>
            </div>
            {trackedProducts.length === 0 && <div className="empty mono">No tracked stock yet.</div>}
            {trackedProducts.map((p) => {
              const map = stockMap(p)
              return (
                <div className="mini-row sl-row" key={p.id}>
                  <div className="sl-who">
                    <span className="sl-thumb">
                      {p.images?.[0] && <img src={imgUrl(p.images[0], { w: 120 })} alt="" loading="lazy" />}
                      <RestockStar sizes={starSizes(p)} />
                    </span>
                    <div>
                      <div className="mini-name">{p.name}</div>
                      <div className="mini-id mono" style={{ marginTop: '3px' }}>{[p.id, p.variant].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                  <span className="stock-chips">
                    {(p.sizes || []).map((s) => {
                      const n = map[s] ?? 0
                      return (
                        <span
                          key={s}
                          className={`chip-stock ${n === 0 ? 'out' : n <= LOW_STOCK_AT ? 'low' : 'ok'}`}
                        >
                          {s} {n}
                        </span>
                      )
                    })}
                    {(() => {
                      const total = (p.sizes || []).reduce((sum, s) => sum + (map[s] ?? 0), 0)
                      return (
                        <span className={`sl-total mono ${total === 0 ? 'out' : total <= LOW_STOCK_AT * 2 ? 'low' : 'ok'}`}>
                          {total} total
                        </span>
                      )
                    })()}
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
                <div className="sl-who">
                  <span className="sl-thumb">
                    {productsById.get(String(p.id))?.images?.[0] && (
                      <img src={imgUrl(productsById.get(String(p.id)).images[0], { w: 120 })} alt="" loading="lazy" />
                    )}
                  </span>
                  <div>
                    <div className="mini-name">{String(i + 1).padStart(2, '0')} · {p.name}</div>
                    <div className="mini-id mono" style={{ marginTop: '3px' }}>
                      {[productsById.get(String(p.id))?.variant, p.id].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                </div>
                <div className="mini-right">
                  <div className="mono">{p.units} sold</div>
                  <div className="mono dim">{taka(p.value)}</div>
                </div>
              </div>
            ))}
          </section>
          )}

          {productsSub === 'drops' && <DropReport products={products} orders={orders} />}

          {productsSub === 'margin' && (
            <div className="margin-views mono" role="tablist">
              {[['product', 'Per product'], ['drop', 'Drop profit']].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={marginView === k} className={`chip ${marginView === k ? 'on' : ''}`} onClick={() => setMarginView(k)}>
                  {label.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {productsSub === 'margin' && marginView === 'drop' && <DropProfit orders={orders} products={products} />}
          {productsSub === 'margin' && marginView === 'product' && (
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
                  <div className="mini-id mono" style={{ marginTop: '3px' }}>{[m.id, m.variant].filter(Boolean).join(' · ')}</div>
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

          {customersSub === 'accounts' && <AccountsManager orders={orders} onOpenOrder={openOrder} />}

          {customersSub === 'repeat' && (
          <>
          <div className="stat-row four">
            <StatCard label="CUSTOMERS" value={custSplit.new + custSplit.repeat} icon={<IconStar />} note="One per phone number" />
            <StatCard label="NEW · 1 ORDER" value={custSplit.new} icon={<IconBox />} />
            <StatCard label="REPEAT · 2+ ORDERS" tone="good" value={custSplit.repeat} icon={<IconCheck />} />
            <StatCard label="CAME BACK" tone="good" value={`${custSplit.rate}%`} icon={<IconTrend />} note="Share of customers who ordered again" />
          </div>

          {/* Where the money comes from: first-timers or the ones who came back. */}
          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '12px' }}>COLLECTED · NEW VS REPEAT</div>
            {(() => {
              const total = custSplit.newSpent + custSplit.repeatSpent
              const pct = total ? Math.round((custSplit.repeatSpent / total) * 100) : 0
              return (
                <>
                  <div className="rv-split">
                    <div><span className="mono dim">New</span><strong>{taka(custSplit.newSpent)}</strong><span className="mono dim">{100 - pct}%</span></div>
                    <div><span className="mono dim">Repeat</span><strong>{taka(custSplit.repeatSpent)}</strong><span className="mono dim">{pct}%</span></div>
                  </div>
                  <div className="rv-bar" aria-hidden="true"><i style={{ width: `${100 - pct}%` }} /><b style={{ width: `${pct}%` }} /></div>
                  <div className="panel-note" style={{ marginTop: '8px' }}>Delivered orders only.</div>
                </>
              )
            })()}
          </section>

          <section className="panel">
            <div className="panel-label mono" style={{ marginBottom: '6px' }}>REGULARS</div>
            <div className="panel-note" style={{ marginBottom: '14px' }}>Everyone who's ordered more than once, most orders first.</div>
            {custSplit.regulars.length === 0 && <div className="empty mono">No repeat customers yet.</div>}
            {custSplit.regulars.map((c) => (
              <div className="mini-row rv-row" key={c.phone}>
                <div className="rv-who">
                  <div className="mini-name">{c.name}</div>
                  <div className="mini-id mono" style={{ marginTop: '3px' }}>
                    <a href={`tel:${c.phone}`}>{c.phone}</a>
                    <a className="wa-mini" href={whatsappLink(c.phone, '')} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${c.name}`}>
                      <IconChat width="13" height="13" />
                    </a>
                  </div>
                  <div className="mini-id mono">
                    First {shortDate(c.firstAt)} · last {shortDate(c.lastAt)}
                  </div>
                </div>
                <div className="mini-right">
                  <div className="mono rv-orders">{c.orders} orders</div>
                  <div className="mono dim">
                    {c.delivered} delivered{c.cancelled ? ` · ${c.cancelled} cancelled` : ''}
                  </div>
                  <div className="mono">{taka(c.totalSpent)}</div>
                </div>
              </div>
            ))}
          </section>
          </>
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
                    <div className="sl-who">
                      <span className="sl-thumb">
                        {productsById.get(String(g.productId))?.images?.[0] && (
                          <img src={imgUrl(productsById.get(String(g.productId)).images[0], { w: 120 })} alt="" loading="lazy" />
                        )}
                      </span>
                      <div>
                        <div className="mini-name">{g.name}</div>
                        <div className="mini-id mono" style={{ marginTop: '3px' }}>
                          {g.size ? `SIZE ${g.size}` : 'WHOLE PRODUCT'} · waiting since{' '}
                          {shortDate(g.waitingSince)}
                        </div>
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
        {SITE_KEYS.includes(tab) && (
          <div className="subtabs mono">
            {SITE_TABS.map((t) => (
              <button key={t.key} className={`subtab ${tab === t.key ? 'active' : ''}`} onClick={() => goTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        {tab === 'hero' && <HeroManager drops={collectionNames} ticker={<TickerManager />} />}
        {!loading && tab === 'menu' && (
          <div className="ab-grid">
            <CategoryManager menu="shop" products={products} />
            <CategoryManager menu="drops" products={products} />
          </div>
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
            <AdsRoas orders={orders} legacy={adSpend} onDeleteLegacy={(id) => handleMarketingDelete(adSpendApi, id)} />
          )}

          {marketingSub === 'email' && (
            <EmailCampaigns
              orders={orders}
              adminEmail={import.meta.env.VITE_ADMIN_EMAIL}
              onDeleteLegacy={(id) => handleMarketingDelete(emailCampaignsApi, id)}
            />
          )}

          {marketingSub === 'social' && (
            <SocialTracking
              rows={socialStats}
              onSynced={reload}
              onAdd={async (row) => {
                const { error } = await socialStatsApi.add(row)
                if (!error) reload()
                return error
              }}
              onDelete={(id) => handleMarketingDelete(socialStatsApi, id)}
            />
          )}

          {marketingSub === 'sales' && <SaleManager products={products} />}

          {marketingSub === 'coupons' && <CouponManager orders={orders} />}

          {marketingSub === 'links' && <LinkGenerator products={products} />}

          {marketingSub === 'setup' && <MarketingGuide />}

          {marketingSub === 'audience' && <AudienceManager orders={orders} products={products} />}
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

          {analyticsSub === 'report'
            ? <InvestorReport orders={orders} products={products} />
            : <AnalyticsManager sub={analyticsSub} orders={orders} products={products} />}
          </>
        )}
        {!loading && tab === 'lookbook' && <LookbookManager products={products} />}
        {tab === 'about' && <AboutManager />}
        {!loading && tab === 'banners' && <PromoManager products={products} />}
        {!loading && tab === 'support' && (
          <>
            <div className="subtabs mono">
              {SUPPORT_SUBS.map((s) => (
                <button
                  key={s.key}
                  className={`subtab ${supportSub === s.key ? 'active' : ''}`}
                  onClick={() => setSupportSub(s.key)}
                >
                  {s.label}
                  {s.key === 'requests' && newRequests > 0 && <span className="badge">{newRequests}</span>}
                </button>
              ))}
            </div>
            {supportSub === 'requests' && (
              <ReturnsManager
                requests={returns}
                orders={orders}
                products={products}
                onReload={reload}
                onSeen={(ids) => {
                  const at = new Date().toISOString()
                  setReturns((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, seen_at: at } : r)))
                }}
              />
            )}
            {supportSub === 'pages' && <SupportPages />}
            {supportSub === 'portal' && <SupportPortal />}
          </>
        )}
      </div>
      </main>

      {slips?.length > 0 && (
        <div className="slip-root">
          {slips.map((o) => <PackingSlip key={o.id} order={o} />)}
        </div>
      )}

      <CommandSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        orders={orders}
        products={products}
        onOpenOrder={openOrder}
        onOpenProduct={(p) => { setProductsSub('catalog'); goTab('products'); setEditing(p) }}
        onOpenCustomer={(phone) => { openOrders('all'); setSearch(phone) }}
      />
    </div>
  )
}
