import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { currentUser, signOutUser } from '../lib/auth.js'
import { isAdminEmail } from '../lib/admin.js'
import { fetchMyWishlist, removeFromWishlist } from '../lib/wishlist.js'
import { fetchProducts } from '../lib/products.js'
import { cld } from '../lib/cloudinary.js'
import usePageMeta from '../lib/usePageMeta.js'
import './account.css'

function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function Account() {
  const navigate = useNavigate()
  const [user, setUser] = useState(undefined) // undefined = checking, null = signed out
  const [rows, setRows] = useState([])
  const [products, setProducts] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(null)

  usePageMeta('My account')

  useEffect(() => {
    let cancelled = false

    currentUser().then(async (u) => {
      if (cancelled) return
      setUser(u)
      if (!u) return

      const [{ rows: mine, error: listError }, { products: all }] = await Promise.all([
        fetchMyWishlist(),
        fetchProducts(),
      ])
      if (cancelled) return

      if (listError) setError("Couldn't load your wishlist. Try again in a moment.")
      setRows(mine)
      setProducts(new Map(all.map((p) => [String(p.id), p])))
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

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

  if (user === undefined) return null
  if (user === null) return <Navigate to="/login?next=/account" replace />

  const name = user.user_metadata?.full_name || ''
  const waiting = rows.filter((r) => !r.notified_at)
  const notified = rows.filter((r) => r.notified_at)

  function renderRow(r) {
    const product = products.get(String(r.product_id))
    const image = product?.images?.[0]

    return (
      <li key={r.id} className="acct-item">
        <Link to={`/product/${r.product_id}`} className="acct-thumb">
          {image ? <img src={cld(image, { w: 200 })} alt="" /> : <span className="acct-noimg" />}
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

        <h2 className="acct-title mono">MY WISHLIST</h2>
        <p className="acct-note">
          Sold-out sizes you asked us about. When one comes back we email you once.
        </p>

        {error && <div className="acct-error mono">{error}</div>}

        {loading ? (
          <div className="acct-empty mono">LOADING…</div>
        ) : rows.length === 0 ? (
          <div className="acct-empty">
            <div className="mono">NOTHING HERE YET</div>
            <p>
              When a size is sold out, leave your email on the product page and it will
              show up here. Use the same email as this account.
            </p>
            <Link to="/shop" className="acct-shop mono">BROWSE THE SHOP</Link>
          </div>
        ) : (
          <>
            {waiting.length > 0 && <ul className="acct-list">{waiting.map(renderRow)}</ul>}
            {notified.length > 0 && (
              <>
                <h3 className="acct-sub mono">ALREADY EMAILED</h3>
                <ul className="acct-list">{notified.map(renderRow)}</ul>
              </>
            )}
          </>
        )}
      </div>

      <Footer />
    </>
  )
}
