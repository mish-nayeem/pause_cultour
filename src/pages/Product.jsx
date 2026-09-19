import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { IconShare } from '../components/Icons.jsx'
import { fetchProductById, fetchColourOptions } from '../lib/products.js'
import { cld } from '../lib/cloudinary.js'
import { useCart } from '../context/CartContext.jsx'
import { availableSizes, isAllSoldOut, isSoldOut, left, soldOutSizes } from '../lib/stock.js'
import { joinWishlist, hasJoined, savedEmail } from '../lib/wishlist.js'
import { currentUser } from '../lib/auth.js'
import { isAdminEmail } from '../lib/admin.js'
import { fetchRatingSummary, submitReview } from '../lib/reviews.js'
import usePageMeta, { useProductSchema } from '../lib/usePageMeta.js'
import './product.css'

// Slides over the page for the DETAILS and SIZE CHART panels. Escape and a
// click on the backdrop both close it, since the button is easy to miss on a
// phone.
function Sheet({ eyebrow, title, onClose, children }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="sheet-back" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <div className="sheet-eyebrow mono">{eyebrow}</div>
            <h2 className="display">{title}</h2>
          </div>
          <button className="sheet-close mono" onClick={onClose}>CLOSE</button>
        </div>

        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

export default function Product() {
  const { id } = useParams()
  const { addItem, items } = useCart()

  const [product, setProduct] = useState(null)
  const [colours, setColours] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [activeSize, setActiveSize] = useState(null)
  const [justAdded, setJustAdded] = useState(false)
  const [capped, setCapped] = useState(false)
  const [wishEmail, setWishEmail] = useState(savedEmail)
  const [wishState, setWishState] = useState('idle') // idle | saving | error

  // A signed-in customer's list is the rows under their account email, so the
  // restock form starts with that address rather than whatever was typed last.
  // Not for the admin — their login isn't a shopper's address.
  useEffect(() => {
    currentUser().then((u) => {
      if (u?.email && !isAdminEmail(u.email)) setWishEmail(u.email)
    })
  }, [])
  const [wishDone, setWishDone] = useState(null) // the size just signed up for
  const [sheet, setSheet] = useState(null) // null | 'details' | 'sizes'
  const [shot, setShot] = useState(0)
  const [shared, setShared] = useState(false)
  const [ratings, setRatings] = useState([])
  const [reviewForm, setReviewForm] = useState({ name: '', rating: 5, comment: '' })
  const [reviewState, setReviewState] = useState('idle') // idle | saving | error | done

  const galleryRef = useRef(null)

  usePageMeta(
    product?.name,
    product ? `${product.name} — ${product.variant}, ৳${product.price}. ${product.description}` : undefined
  )
  useProductSchema(product)

  useEffect(() => {
    let active = true
    setLoading(true)
    setNotFound(false)
    setSheet(null)
    setShot(0)

    fetchProductById(id).then(({ product, error }) => {
      if (!active) return
      if (error || !product) {
        setNotFound(true)
      } else {
        setProduct(product)
        setActiveSize(availableSizes(product)[0] || null)
      }
      setLoading(false)
    })

    // Jumping to the top matters here because the sticky column keeps its
    // scroll position when moving between products otherwise.
    window.scrollTo(0, 0)
    return () => { active = false }
  }, [id])

  const colourGroup = product?.colourGroup

  useEffect(() => {
    if (!colourGroup) {
      setColours([])
      return
    }

    let active = true
    fetchColourOptions(colourGroup).then(({ options }) => {
      if (active) setColours(options)
    })
    return () => { active = false }
  }, [colourGroup])

  useEffect(() => {
    let active = true
    setReviewForm({ name: '', rating: 5, comment: '' })
    setReviewState('idle')

    fetchRatingSummary(id).then(({ ratings }) => {
      if (active) setRatings(ratings)
    })
    return () => { active = false }
  }, [id])

  async function handleReviewSubmit(e) {
    e.preventDefault()
    if (!reviewForm.name.trim()) {
      setReviewState('error')
      return
    }

    setReviewState('saving')
    const { error } = await submitReview({
      productId: id,
      name: reviewForm.name.trim(),
      rating: reviewForm.rating,
      comment: reviewForm.comment,
    })

    if (error) {
      setReviewState('error')
      return
    }

    const { ratings: fresh } = await fetchRatingSummary(id)
    setRatings(fresh)
    setReviewState('done')
  }

  // Only the phone layout scrolls sideways; on desktop the gallery is a grid
  // with nothing to scroll, so this never fires there.
  const handleGalleryScroll = useCallback((e) => {
    const el = e.currentTarget
    setShot(Math.round(el.scrollLeft / el.clientWidth))
  }, [])

  function stepShot(dir) {
    const el = galleryRef.current
    if (!el || !product) return
    const next = Math.max(0, Math.min(shot + dir, product.images.length - 1))
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
  }

  async function handleWishlist(e) {
    e.preventDefault()
    if (!product || !activeSize || wishState === 'saving') return

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(wishEmail.trim())) {
      setWishState('error')
      return
    }

    setWishState('saving')
    const { error } = await joinWishlist({
      product,
      size: activeSize,
      email: wishEmail,
    })

    if (error) {
      setWishState('error')
      return
    }

    setWishState('idle')
    setWishDone(activeSize)
  }

  // Tagged with its own source, same as a link built in the admin panel, so
  // a sale that started with someone hitting this button shows up under
  // "share" on the Overview tab instead of vanishing into "Direct".
  async function handleShare() {
    if (!product) return

    const url = `${window.location.origin}/product/${product.id}?utm_source=share&utm_medium=native`
    const text = `${product.name} — ${product.variant}, ৳${product.price.toLocaleString()}`

    if (navigator.share) {
      try {
        await navigator.share({ title: `${product.name} — PAUSE`, text, url })
      } catch {
        // Cancelled from the share sheet — not an error worth reporting.
      }
      return
    }

    try {
      await navigator.clipboard.writeText(url)
      setShared(true)
      setTimeout(() => setShared(false), 2000)
    } catch {
      // Clipboard access can be blocked; there's nothing more to fall back to here.
    }
  }

  function handleAddToCart() {
    if (!product || !activeSize || isSoldOut(product, activeSize)) return

    // The cart holds pieces that haven't been ordered yet, so they aren't off
    // the count in the database — the check has to include them or someone can
    // fill their cart past what exists and only find out at checkout.
    const remaining = left(product, activeSize)

    if (remaining !== null) {
      const inCart = items
        .filter((i) => i.id === product.id && i.size === activeSize)
        .reduce((sum, i) => sum + i.qty, 0)

      if (inCart >= remaining) {
        setCapped(true)
        setTimeout(() => setCapped(false), 2600)
        return
      }
    }

    addItem(product, activeSize, 1)
    setJustAdded(true)
    setTimeout(() => setJustAdded(false), 1600)
  }

  if (loading) {
    return (
      <>
        <Nav />
        <p className="mono" style={{ padding: '40px' }}>Loading product…</p>
      </>
    )
  }

  if (notFound || !product) {
    return (
      <>
        <Nav />
        <div style={{ padding: '40px' }}>
          <p className="mono" style={{ marginBottom: '16px' }}>Couldn't find that product.</p>
          <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
        </div>
      </>
    )
  }

  const detailLines = product.details
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  // Read straight from the browser's note each render — no state to keep in
  // step when the shopper switches size.
  const joined = Boolean(activeSize && hasJoined(product.id, activeSize))

  const chart = product.sizeChart
  const hasChart = Boolean(chart?.columns?.length && chart?.rows?.length)
  const chartNotes = (chart?.notes || []).map((n) => n.trim()).filter(Boolean)

  const avgRating = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    : 0

  return (
    <>
      <Nav />

      <div className="crumb mono">
        <Link to="/shop">SHOP</Link> / {product.drop} / <span>{product.name.toUpperCase()}</span>
      </div>

      <div className="pdp">
        {/* Two columns of stills on desktop; one swipeable rail on a phone. Same
            markup either way — only the container's display changes. */}
        <div className="gallery-wrap">
          <div className="gallery" ref={galleryRef} onScroll={handleGalleryScroll}>
            {product.images.map((img, i) => (
              <div className="shot" key={img}>
                <img
                  src={cld(img, { w: 1000 })}
                  alt={`${product.name} — view ${i + 1}`}
                  loading={i > 1 ? 'lazy' : undefined}
                />
              </div>
            ))}
          </div>

          {/* Phone only. The arrows are what tell you there are more frames
              either side — a rail with no handles reads as a single photo. */}
          {product.images.length > 1 && (
            <div className="rail-nav mono">
              <button
                onClick={() => stepShot(-1)}
                disabled={shot === 0}
                aria-label="Previous photo"
              >
                ‹
              </button>
              <span className="rail-count">
                {String(shot + 1).padStart(2, '0')} / {String(product.images.length).padStart(2, '0')}
              </span>
              <button
                onClick={() => stepShot(1)}
                disabled={shot >= product.images.length - 1}
                aria-label="Next photo"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {/* Sticks while the stills scroll past, so size and price stay reachable
            however many photos the product has. */}
        <aside className="info">
          <div className="code-row">
            <div className="code mono">{product.sku} · {product.variant.toUpperCase()}</div>
            <button type="button" className="share-btn mono" onClick={handleShare}>
              <IconShare width="15" height="15" strokeWidth="2.2" />
              {shared ? 'LINK COPIED' : 'SHARE'}
            </button>
          </div>
          <h1 className="display">{product.name}</h1>
          <div className="price mono">৳ {product.price.toLocaleString()}</div>
          <p className="desc">{product.description}</p>

          <div className="field-label mono">SIZE</div>
          <div className="sizes">
            {product.sizes.map((s) => {
              const out = isSoldOut(product, s)

              return (
                <div
                  key={s}
                  className={`size-opt ${out ? 'disabled' : ''} ${activeSize === s ? 'active' : ''}`}
                  onClick={() => {
                    setActiveSize(s)
                    setWishState('idle')
                  }}
                >
                  {s}
                </div>
              )
            })}
            {/* Anything struck off by hand that was never in the size list. */}
            {soldOutSizes(product)
              .filter((s) => !product.sizes.includes(s))
              .map((s) => (
                <div key={s} className="size-opt disabled">{s}</div>
              ))}
          </div>

          <button
            className="add-cart mono"
            onClick={handleAddToCart}
            disabled={!activeSize || isSoldOut(product, activeSize)}
          >
            {!activeSize || isSoldOut(product, activeSize)
              ? 'Sold out'
              : justAdded
                ? 'Added to cart ✓'
                : 'Add to cart'}
          </button>
          {capped && (
            <div className="added-note mono">
              That's every piece we have left in {activeSize}.
            </div>
          )}

          {/* A sold-out size is a dead end otherwise. Leaving an address turns
              it into the queue for the next run — and tells us which sizes to
              actually make more of. */}
          {(isAllSoldOut(product) || (activeSize && isSoldOut(product, activeSize))) && (
            <div className="wish">
              {!activeSize ? (
                <>
                  <div className="wish-head mono">EMAIL ME WHEN IT'S BACK</div>
                  <div className="wish-note mono" style={{ marginTop: 0 }}>
                    Pick the size you're after, above.
                  </div>
                </>
              ) : wishDone === activeSize || joined ? (
                <div className="wish-done mono">
                  You're on the list for {activeSize} — we'll email you the day
                  it's back.
                </div>
              ) : (
                <form onSubmit={handleWishlist}>
                  <div className="wish-head mono">EMAIL ME WHEN {activeSize} IS BACK</div>
                  <div className="wish-row">
                    <input
                      type="email"
                      value={wishEmail}
                      onChange={(e) => setWishEmail(e.target.value)}
                      placeholder="you@example.com"
                      aria-label="Your email address"
                    />
                    <button type="submit" className="mono" disabled={wishState === 'saving'}>
                      {wishState === 'saving' ? '…' : 'NOTIFY ME'}
                    </button>
                  </div>
                  <div className="wish-note mono">
                    {wishState === 'error'
                      ? "That didn't go through — check the address and try again."
                      : 'One email, only for this size. Nothing else.'}
                  </div>
                </form>
              )}
            </div>
          )}
          {justAdded && (
            <div className="added-note mono">
              In your cart. <Link to="/cart">View cart →</Link>
            </div>
          )}

          {/* Each button hides itself when the admin left that content empty,
              so a product never opens a panel with nothing in it. */}
          {(detailLines.length > 0 || hasChart) && (
            <div className="panel-links mono">
              {detailLines.length > 0 && (
                <button onClick={() => setSheet('details')}>DETAILS <span>›</span></button>
              )}
              {hasChart && (
                <button onClick={() => setSheet('sizes')}>SIZE CHART <span>›</span></button>
              )}
            </div>
          )}

          {/* On a phone this jumps above everything else in the column, which
              puts it directly under the photo rail. */}
          {colours.length > 1 && (
            <div className="colours">
              <div className="field-label mono">COLOUR</div>
              <div className="colour-row">
                {colours.map((c) => (
                  <Link
                    key={c.id}
                    to={`/product/${c.id}`}
                    className={`colour-chip ${c.id === product.id ? 'on' : ''}`}
                    title={c.variant}
                  >
                    {c.images?.[0] && <img src={cld(c.images[0], { w: 160 })} alt={c.variant} />}
                  </Link>
                ))}
              </div>
              <div className="colour-name mono">{product.variant}</div>
            </div>
          )}

          <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
        </aside>
      </div>

      <div className="reviews-section">
        <div className="reviews-head">
          <h2 className="display">Reviews</h2>
          {ratings.length > 0 && (
            <div className="reviews-avg mono">
              {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}
              <span className="reviews-avg-detail"> {avgRating.toFixed(1)} · {ratings.length} review{ratings.length === 1 ? '' : 's'}</span>
            </div>
          )}
        </div>

        {ratings.length === 0 && <p className="mono reviews-empty">No reviews yet — be the first.</p>}

        <form className="review-form" onSubmit={handleReviewSubmit}>
          <div className="field-label mono">LEAVE A REVIEW</div>
          <div className="review-form-row">
            <input
              placeholder="Your name"
              value={reviewForm.name}
              onChange={(e) => setReviewForm({ ...reviewForm, name: e.target.value })}
            />
            <select
              value={reviewForm.rating}
              onChange={(e) => setReviewForm({ ...reviewForm, rating: Number(e.target.value) })}
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="What did you think? (optional)"
            rows={3}
            value={reviewForm.comment}
            onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
          />
          {reviewState === 'error' && (
            <em className="review-error mono">Enter your name to submit a review.</em>
          )}
          {reviewState === 'done' ? (
            <div className="mono">Thanks — your review is up.</div>
          ) : (
            <button type="submit" className="mono" disabled={reviewState === 'saving'}>
              {reviewState === 'saving' ? 'Posting…' : 'Post review'}
            </button>
          )}
        </form>
      </div>

      {sheet === 'details' && (
        <Sheet eyebrow="DETAILS" title={product.name} onClose={() => setSheet(null)}>
          <ul className="sheet-list">
            {detailLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Sheet>
      )}

      {sheet === 'sizes' && (
        <Sheet eyebrow="SIZE CHART" title={product.name} onClose={() => setSheet(null)}>
          <div className="sheet-table-wrap">
            <table className="sheet-table mono">
              <thead>
                <tr>
                  <th />
                  {chart.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.rows.map((row, ri) => (
                  <tr key={ri}>
                    <td className="row-label">{row.label}</td>
                    {chart.columns.map((c, ci) => (
                      <td key={c}>{row.values[ci] || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {chartNotes.length > 0 && (
            <ul className="sheet-list">
              {chartNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </Sheet>
      )}

      <Footer />
    </>
  )
}
