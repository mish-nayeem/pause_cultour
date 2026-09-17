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
  topProducts,
} from '../lib/admin.js'
import { sendStatusUpdate } from '../lib/email.js'
import { cld } from '../lib/cloudinary.js'
import ProductForm from '../components/ProductForm.jsx'
import HeroManager from '../components/HeroManager.jsx'
import CategoryManager from '../components/CategoryManager.jsx'
import AboutManager from '../components/AboutManager.jsx'
import { fetchAllNavCategories } from '../lib/navCategories.js'
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

export default function Admin() {
  const [session, setSession] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  const [tab, setTab] = useState('overview')
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [navCategories, setNavCategories] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [search, setSearch] = useState('')
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

    const [o, p, c] = await Promise.all([
      fetchOrders(),
      fetchAdminProducts(),
      fetchAllNavCategories(),
    ])

    if (o.error) {
      setLoadError(
        "Couldn't load orders. Make sure you ran the admin SQL policies in Supabase."
      )
    }

    setOrders(o.orders)
    setProducts(p.products)
    setNavCategories(c.categories)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!session) return
    reload()
  }, [session, reload])

  const stats = useMemo(() => computeStats(orders), [orders])
  const series = useMemo(() => dailySeries(orders, 14), [orders])
  const top = useMemo(() => topProducts(orders, 5), [orders])

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
    if (!search.trim()) return orders
    const q = search.trim().toLowerCase()
    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.includes(q)
    )
  }, [orders, search])

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
            {stats.pending > 0 && <span className="badge">{stats.pending}</span>}
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
          <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>
            <span className="nav-left"><IconStar />About us</span>
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
            <div className="stat-row">
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-ico"><IconBox /></span>
                  <div className="stat-label mono">TOTAL ORDERS</div>
                </div>
                <div className="stat-value display">{stats.totalOrders}</div>
              </div>
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-ico warn"><IconClock /></span>
                  <div className="stat-label mono">PENDING</div>
                </div>
                <div className="stat-value display">{stats.pending}</div>
                <div className="stat-note mono">{taka(stats.pendingValue)} to collect</div>
              </div>
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-ico good"><IconCheck /></span>
                  <div className="stat-label mono">DELIVERED</div>
                </div>
                <div className="stat-value display">{stats.delivered}</div>
              </div>
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-ico bad"><IconX /></span>
                  <div className="stat-label mono">CANCELLED</div>
                </div>
                <div className="stat-value display">{stats.cancelled}</div>
              </div>
            </div>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-label mono"><IconCash width="13" height="13" />COLLECTED REVENUE</div>
                  <div className="big display">{taka(stats.revenue)}</div>
                  <div className="panel-note mono">
                    From delivered orders only · {windowOrders} order{windowOrders === 1 ? '' : 's'} in
                    last 14 days ({taka(windowValue)} placed)
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
                    <div className="tc name">{o.customer_name}</div>
                    <div className="tc mono">{o.customer_phone}</div>
                    <div className="tc mono dim">{shortDate(o.created_at)}</div>
                    <div className="tc mono price">{taka(o.subtotal)}</div>
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
                    {Array.isArray(p.sizes) ? p.sizes.join(' · ') : ''}
                  </div>
                  <div className="tc mono">
                    {Array.isArray(p.sizes_out) && p.sizes_out.length > 0 && (
                      <span className="out-tag">{p.sizes_out.length} size out</span>
                    )}
                  </div>
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
    </div>
  )
}
