import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { currentUser, signOutUser } from '../lib/auth.js'
import { isAdminEmail } from '../lib/admin.js'
import { fetchMyWishlist, removeFromWishlist } from '../lib/wishlist.js'
import { fetchProducts } from '../lib/products.js'
import { fetchProfile, saveProfile, fetchMyOrders } from '../lib/account.js'
import { DISTRICTS } from '../lib/delivery.js'
import { isSoldOut, left } from '../lib/stock.js'
import { useCart } from '../context/CartContext.jsx'
import { imgUrl } from '../lib/images.js'
import usePageMeta from '../lib/usePageMeta.js'
import './account.css'

function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function taka(n) {
  return '৳ ' + Number(n || 0).toLocaleString()
}

// What each status means, said to the customer.
const STATUS = {
  pending: { label: 'Order placed', note: "We've got it and we're packing it." },
  shipped: { label: 'On the way', note: 'With the courier — keep the cash ready.' },
  delivered: { label: 'Delivered', note: 'Delivered. Thanks for shopping with us.' },
  returned: { label: 'Came back to us', note: "The courier couldn't reach you. Contact us to have it sent again." },
  cancelled: { label: 'Cancelled', note: 'This order was cancelled. Nothing was charged.' },
}

const TABS = [
  { key: 'orders', label: 'My orders' },
  { key: 'details', label: 'My details' },
  { key: 'wishlist', label: 'Wishlist' },
]

const EMPTY_DETAILS = { name: '', phone: '', district: '', thana: '', postcode: '', address: '' }

// My account: the customer's orders (with Buy again and Return / Exchange),
// the details checkout fills itself from, and their restock wishlist.
export default function Account() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'orders'
  const { addItem, items: cartItems } = useCart()

  const [user, setUser] = useState(undefined) // undefined = checking, null = signed out
  const [rows, setRows] = useState([])
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState(new Map())
  const [details, setDetails] = useState(EMPTY_DETAILS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const [againNote, setAgainNote] = useState(null) // { id, text }

  usePageMeta('My account')

  useEffect(() => {
    let cancelled = false

    currentUser().then(async (u) => {
      if (cancelled) return
      setUser(u)
      if (!u) return

      const [{ rows: mine, error: listError }, { products: all }, { orders: mineOrders }, { profile }] = await Promise.all([
        fetchMyWishlist(),
        fetchProducts(),
        fetchMyOrders(),
        fetchProfile(u.id),
      ])
      if (cancelled) return

      if (listError) setError("Couldn't load your wishlist. Try again in a moment.")
      setRows(mine)
      setOrders(mineOrders)
      setProducts(new Map(all.map((p) => [String(p.id), p])))
      // Nothing saved yet: start from their latest order's details.
      const last = mineOrders[0]
      setDetails({
        ...EMPTY_DETAILS,
        ...(last ? { name: last.customer_name || '', phone: last.customer_phone || '', district: last.customer_area || '' } : {}),
        ...Object.fromEntries(Object.entries(profile || {}).filter(([k, v]) => k in EMPTY_DETAILS && v)),
      })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  const name = details.name || user?.user_metadata?.full_name || ''

  const waiting = useMemo(() => rows.filter((r) => !r.notified_at), [rows])
  const notified = useMemo(() => rows.filter((r) => r.notified_at), [rows])

  async function handleRemove(id) {
    setRemoving(id)
    const { error: err } = await removeFromWishlist(id)
    setRemoving(null)

    if (err) {
      setError("Couldn't remove that one. Try again.")
      return
    }
    setError('')
    setRows((list) => list.filter((r) => r.id !== id))
  }

  async function handleSignOut() {
    await signOutUser()
    navigate('/', { replace: true })
  }

  async function handleSaveDetails(e) {
    e.preventDefault()
    if (details.phone.trim() && !/^01[3-9]\d{8}$/.test(details.phone.trim())) {
      setSavedNote('Enter a valid Bangladeshi number (e.g. 017XXXXXXXX).')
      return
    }
    if (details.postcode.trim() && !/^\d{4}$/.test(details.postcode.trim())) {
      setSavedNote('Postal code is 4 digits, e.g. 1204.')
      return
    }
    setSaving(true)
    const { error: err } = await saveProfile(user, details, { replace: true })
    setSaving(false)
    setSavedNote(err ? "Couldn't save — try again in a moment." : 'Saved. Checkout will fill these in for you.')
  }

  // Everything on an old order that can still be bought, into the cart —
  // the same size, as many as are left.
  function buyAgain(o) {
    let added = 0
    const skipped = []
    for (const it of o.items || []) {
      const p = products.get(String(it.product_id))
      if (!p || !(p.sizes || []).includes(it.size) || isSoldOut(p, it.size)) {
        skipped.push(`${it.product_name} ${it.size}`)
        continue
      }
      const max = left(p, it.size)
      const inCart = cartItems.filter((c) => c.id === p.id && c.size === it.size).reduce((n, c) => n + c.qty, 0)
      const qty = max === null ? Number(it.qty) : Math.min(Number(it.qty), Math.max(0, max - inCart))
      if (qty < 1) {
        skipped.push(`${it.product_name} ${it.size}`)
        continue
      }
      addItem(p, it.size, qty)
      added += qty
    }
    setAgainNote({
      id: o.id,
      added,
      text: added
        ? `${added} piece${added === 1 ? '' : 's'} added to your cart.${skipped.length ? ` Not available now: ${skipped.join(', ')}.` : ''}`
        : 'Nothing from this order is available right now.',
    })
  }

  if (user === undefined) return null
  if (user === null) return <Navigate to="/login?next=/account" replace />

  function renderWish(r) {
    const product = products.get(String(r.product_id))
    const image = product?.images?.[0]

    return (
      <li key={r.id} className="acct-item">
        <Link to={`/product/${r.product_id}`} className="acct-thumb">
          {image ? <img src={imgUrl(image, { w: 200 })} alt="" /> : <span className="acct-noimg" />}
        </Link>

        <div className="acct-info">
          <Link to={`/product/${r.product_id}`} className="acct-name">
            {product?.name || r.product_name}
          </Link>
          <div className="acct-meta mono">
            {r.size ? `SIZE ${r.size}` : 'ANY SIZE'}
            {product?.variant ? ` · ${product.variant.toUpperCase()}` : ''}
          </div>
          <div className={`acct-status mono ${r.notified_at ? 'back' : ''}`}>
            {r.notified_at
              ? `BACK IN STOCK — WE EMAILED YOU ${shortDate(r.notified_at).toUpperCase()}`
              : `WAITING SINCE ${shortDate(r.created_at).toUpperCase()} — WE'LL EMAIL YOU`}
          </div>
        </div>

        <button
          type="button"
          className="acct-remove mono"
          onClick={() => handleRemove(r.id)}
          disabled={removing === r.id}
        >
          {removing === r.id ? '…' : 'REMOVE'}
        </button>
      </li>
    )
  }

  function renderOrder(o) {
    const st = STATUS[o.status] || { label: o.status, note: '' }
    const pieces = (o.items || []).reduce((n, it) => n + Number(it.qty), 0)
    return (
      <li key={o.id} className="acct-order">
        <div className="acct-order-head">
          <div>
            <div className="acct-order-id mono">{o.id}</div>
            <div className="acct-order-when mono">{shortDate(o.created_at)} · {pieces} piece{pieces === 1 ? '' : 's'}</div>
          </div>
          <span className={`acct-pill mono ${o.status}`}>{st.label}</span>
        </div>

        <ul className="acct-order-items">
          {(o.items || []).map((it, i) => {
            const p = products.get(String(it.product_id))
            const image = p?.images?.[0]
            return (
              <li key={i}>
                <Link to={`/product/${it.product_id}`} className="acct-order-thumb">
                  {image ? <img src={imgUrl(image, { w: 120 })} alt="" /> : <span className="acct-noimg" />}
                </Link>
                <span className="acct-order-what">
                  {it.product_name}
                  <span className="mono"> · {it.size} × {it.qty}</span>
                </span>
                <span className="mono">{taka(it.price * it.qty)}</span>
              </li>
            )
          })}
        </ul>

        <div className="acct-order-foot">
          <span className="acct-order-note">{st.note}</span>
          <span className="acct-order-total mono">{taka(o.total ?? o.subtotal)}</span>
        </div>

        <div className="acct-order-actions mono">
          <button type="button" onClick={() => buyAgain(o)}>BUY AGAIN</button>
          {o.status === 'delivered' && (
            <Link to={`/support/portal?order=${encodeURIComponent(o.id)}&contact=${encodeURIComponent(user.email)}`}>
              RETURN / EXCHANGE
            </Link>
          )}
          {againNote?.id === o.id && againNote.added > 0 && <Link to="/cart">VIEW CART →</Link>}
        </div>
        {againNote?.id === o.id && <div className="acct-order-msg mono">{againNote.text}</div>}
      </li>
    )
  }

  const field = (key, label, props = {}) => (
    <label className="acct-field">
      <span className="mono">{label}</span>
      <input
        value={details[key]}
        onChange={(e) => { setDetails({ ...details, [key]: e.target.value }); setSavedNote('') }}
        {...props}
      />
    </label>
  )

  return (
    <>
      <Nav />

      <div className="acct-page">
        <div className="acct-head">
          <div className="acct-eyebrow mono">MY ACCOUNT</div>
          <h1 className="display">{name || 'Welcome'}</h1>
          <div className="acct-email mono">{user.email}</div>

          <div className="acct-actions mono">
            {isAdminEmail(user.email) && <Link to="/admin">OPEN ADMIN PANEL</Link>}
            <button type="button" onClick={handleSignOut}>SIGN OUT</button>
          </div>
        </div>

        <div className="acct-tabs mono" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? 'on' : ''}
              onClick={() => setParams(t.key === 'orders' ? {} : { tab: t.key }, { replace: true })}
            >
              {t.label}
              {t.key === 'orders' && orders.length > 0 && <span>{orders.length}</span>}
              {t.key === 'wishlist' && rows.length > 0 && <span>{rows.length}</span>}
            </button>
          ))}
        </div>

        {error && <div className="acct-error mono">{error}</div>}

        {loading ? (
          <div className="acct-empty mono">LOADING…</div>
        ) : tab === 'orders' ? (
          <>
            <p className="acct-note">
              Every order placed with {user.email}. Buy again puts the same pieces back in your cart.
            </p>
            {orders.length === 0 ? (
              <div className="acct-empty">
                <div className="mono">NO ORDERS YET</div>
                <p>Orders you place with this email show up here.</p>
                <Link to="/shop" className="acct-shop mono">BROWSE THE SHOP</Link>
              </div>
            ) : (
              <ul className="acct-orders">{orders.map(renderOrder)}</ul>
            )}
          </>
        ) : tab === 'details' ? (
          <form className="acct-details" onSubmit={handleSaveDetails}>
            <p className="acct-note">Saved to your account — checkout fills these in for you, on any device.</p>
            {field('name', 'FULL NAME', { autoComplete: 'name' })}
            {field('phone', 'PHONE NUMBER', { inputMode: 'tel', placeholder: '017XXXXXXXX', autoComplete: 'tel' })}
            <label className="acct-field">
              <span className="mono">DISTRICT</span>
              <select value={details.district} onChange={(e) => { setDetails({ ...details, district: e.target.value }); setSavedNote('') }}>
                <option value="">Select district</option>
                {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <div className="acct-pair">
              {field('thana', 'AREA / THANA')}
              {field('postcode', 'POSTAL CODE', { inputMode: 'numeric', maxLength: 4 })}
            </div>
            <label className="acct-field">
              <span className="mono">FULL ADDRESS</span>
              <textarea rows={3} value={details.address} onChange={(e) => { setDetails({ ...details, address: e.target.value }); setSavedNote('') }} />
            </label>
            <button type="submit" className="acct-shop mono" disabled={saving}>{saving ? 'SAVING…' : 'SAVE DETAILS'}</button>
            {savedNote && <div className="acct-saved mono">{savedNote}</div>}
          </form>
        ) : (
          <>
            <p className="acct-note">
              Sold-out sizes you asked us about. When one comes back we email you once.
            </p>
            {rows.length === 0 ? (
              <div className="acct-empty">
                <div className="mono">NOTHING HERE YET</div>
                <p>
                  When a size is sold out, leave your email on the product page and it will
                  show up here.
                </p>
                <Link to="/shop" className="acct-shop mono">BROWSE THE SHOP</Link>
              </div>
            ) : (
              <>
                {waiting.length > 0 && <ul className="acct-list">{waiting.map(renderWish)}</ul>}
                {notified.length > 0 && (
                  <>
                    <h3 className="acct-sub mono">ALREADY EMAILED</h3>
                    <ul className="acct-list">{notified.map(renderWish)}</ul>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      <Footer />
    </>
  )
}
