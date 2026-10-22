import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import YouMayLike from '../components/YouMayLike.jsx'
import RecentlyViewed from '../components/RecentlyViewed.jsx'
import ShimmerImage from '../components/ShimmerImage.jsx'
import Lightbox from '../components/Lightbox.jsx'
import { IconShare, IconChat, IconPen } from '../components/Icons.jsx'
import { fetchProductById, fetchColourOptions } from '../lib/products.js'
import { ProductPrice } from '../components/SalePrice.jsx'
import { imgUrl } from '../lib/images.js'
import { useCart } from '../context/CartContext.jsx'
import { availableSizes, isSoldOut, left, soldOutSizes } from '../lib/stock.js'
import { joinWishlist, hasJoined, savedEmail } from '../lib/wishlist.js'
import { currentUser } from '../lib/auth.js'
import { parseDetails } from '../lib/details.js'
import { isScheduled, launchLabel } from '../lib/schedule.js'
import { rememberViewed } from '../lib/recent.js'
import { isAdminEmail } from '../lib/admin.js'
import { fetchReviews, submitReview } from '../lib/reviews.js'
import usePageMeta, { useProductSchema } from '../lib/usePageMeta.js'
import './product.css'

// A frosted-glass panel that floats in the middle of the screen for the
// DETAILS and SIZE CHART tables. CLOSE, Escape and a click outside all dismiss
// it, since the button is easy to miss on a phone.
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
  // ?notify=1 — arrived from a sold-out card's NOTIFY ME, so the restock box
  // opens straight away.
  const [searchParams] = useSearchParams()
  const wantsNotify = searchParams.get('notify') === '1'
  const { addItem, items } = useCart()

  const [product, setProduct] = useState(null)
  const [colours, setColours] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [activeSize, setActiveSize] = useState(null)
  const [justAdded, setJustAdded] = useState(false)
  // Add to cart pressed before a size was picked: "Select a size" shows.
  const [needSize, setNeedSize] = useState(false)
  // The photo open full screen (its index), or null.
  const [zoom, setZoom] = useState(null)
  const [capped, setCapped] = useState(false)
  const [wishEmail, setWishEmail] = useState(savedEmail)
  const [wishState, setWishState] = useState('idle') // idle | saving | error
  const [accountEmail, setAccountEmail] = useState('') // signed-in customer only

  // A signed-in customer's list is the rows under their account email, so the
  // restock form starts with that address rather than whatever was typed last.
  // Not for the admin — their login isn't a shopper's address.
  useEffect(() => {
    currentUser().then((u) => {
      if (u?.email && !isAdminEmail(u.email)) {
        setWishEmail(u.email)
        setAccountEmail(u.email)
      }
    })
  }, [])
  const [wishDone, setWishDone] = useState(null) // the size just signed up for
  const [notifyOpen, setNotifyOpen] = useState(false) // the restock box under the button
  const [sheet, setSheet] = useState(null) // null | 'details' | 'sizes'
  const [shot, setShot] = useState(0)
  const [shared, setShared] = useState(false)
  const [reviews, setReviews] = useState([])
  const [showReviews, setShowReviews] = useState(false)
  const [writing, setWriting] = useState(false) // the leave-a-review form
  const wishRef = useRef(null)
  // Phones: the add-to-cart bar along the bottom of the screen. Hidden while
  // the page's own button is on screen, and gone for good once the shopper
  // has scrolled down to "You may like".
  const addRef = useRef(null)
  const endRef = useRef(null)
  const [barOn, setBarOn] = useState(false)
  const [barPick, setBarPick] = useState(false) // the bar's size row open
  const [reviewForm, setReviewForm] = useState({ name: '', rating: 5, comment: '' })
  const [reviewState, setReviewState] = useState('idle') // idle | saving | error | done

  const galleryRef = useRef(null)
  const closeZoom = useCallback(() => setZoom(null), [])

  usePageMeta(
    product?.name,
    product ? `${product.name}${product.variant ? ` — ${product.variant}` : ''}. ${product.description || ''}`.trim() : undefined
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
        if (product) rememberViewed(product.id)
        // No size is picked for the shopper — they choose their own.
        setActiveSize(null)
        setNeedSize(false)
        if (wantsNotify) setNotifyOpen(true)
      }
      setLoading(false)
    })

    // Landing at the top on a new product is handled site-wide (SmoothScroll).
    return () => { active = false }
  }, [id])

  // Its other colours: every product with the same name.
  const productName = product?.name

  useEffect(() => {
    if (!productName) {
      setColours([])
      return
    }

    let active = true
    fetchColourOptions(productName).then(({ options }) => {
      if (active) setColours(options)
    })
    return () => { active = false }
  }, [productName])

  useEffect(() => {
    let active = true
    setReviewForm({ name: '', rating: 5, comment: '' })
    setReviewState('idle')
    setShowReviews(false)
    setWriting(false)
    setNotifyOpen(false)

    fetchReviews(id).then(({ reviews }) => {
      if (active) setReviews(reviews)
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

    const { reviews: fresh } = await fetchReviews(id)
    setReviews(fresh)
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

  useEffect(() => {
    if (!notifyOpen || !activeSize) return
    wishRef.current?.querySelector('input')?.focus({ preventScroll: true })
  }, [notifyOpen, activeSize])

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
    setNotifyOpen(false)
  }

  // Tagged with its own source, same as a link built in the admin panel, so
  // a sale that started with someone hitting this button shows up under
  // "share" on the Overview tab instead of vanishing into "Direct".
  async function handleShare() {
    if (!product) return

    const url = `${window.location.origin}/product/${product.id}?utm_source=share&utm_medium=native`
    const text = `${product.name}${product.variant ? ` — ${product.variant}` : ''}`

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

  // Read straight off the page on every scroll — two rects, no re-render
  // unless the answer changes.
  useEffect(() => {
    if (!product) return
    let frame = 0
    function check() {
      frame = 0
      const vh = window.innerHeight
      const btn = addRef.current?.getBoundingClientRect()
      const end = endRef.current?.getBoundingClientRect()
      const btnShowing = btn && btn.top < vh && btn.bottom > 0
      const pastEnd = end && end.top < vh
      const on = !btnShowing && !pastEnd
      setBarOn(on)
      if (!on) setBarPick(false)
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(check)
    }
    // The page keeps growing as photos and reviews arrive, moving both
    // marks — check again whenever its height changes, not only on scroll.
    const grow = 'ResizeObserver' in window ? new ResizeObserver(onScroll) : null
    grow?.observe(document.body)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      grow?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [product])

  function handleAddToCart(size = activeSize) {
    if (product && !size) {
      setNeedSize(true)
      return
    }
    if (!product || isSoldOut(product, size)) return

    // The cart holds pieces that haven't been ordered yet, so they aren't off
    // the count in the database — the check has to include them or someone can
    // fill their cart past what exists and only find out at checkout.
    const remaining = left(product, size)

    if (remaining !== null) {
      const inCart = items
        .filter((i) => i.id === product.id && i.size === size)
        .reduce((sum, i) => sum + i.qty, 0)

      if (inCart >= remaining) {
        setCapped(true)
        setTimeout(() => setCapped(false), 2600)
        return
      }
    }

    addItem(product, size, 1)
    setJustAdded(true)
    setTimeout(() => setJustAdded(false), 1600)
  }

  if (loading) {
    return (
      <>
        <Nav />
        {/* The page's own layout, empty — two photo frames and the detail
            column — so it doesn't jump from a line of text to the full page. */}
        <div className="crumb" aria-hidden="true">
          <span className="skel-line shimmer" style={{ width: '180px' }} />
        </div>
        <div className="pdp pdp-skel" role="status" aria-label="Loading product">
          <div className="gallery" aria-hidden="true">
            <div className="shot shimmer" />
            <div className="shot shimmer" />
          </div>
          <div className="info" aria-hidden="true">
            <span className="skel-line shimmer" style={{ width: '30%', marginBottom: '22px' }} />
            <span className="skel-line shimmer" style={{ width: '80%', height: '34px', marginBottom: '16px' }} />
            <span className="skel-line shimmer" style={{ width: '25%', height: '18px', marginBottom: '32px' }} />
            <span className="skel-line shimmer" style={{ width: '100%', height: '44px', marginBottom: '12px' }} />
            <span className="skel-line shimmer" style={{ width: '100%', height: '48px' }} />
          </div>
        </div>
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

  // Only rows with both the name and the detail filled in are shown — a lone
  // value with no name isn't a detail a shopper can make sense of.
  // Only the values reach the customer — the labels are the admin's.
  const detailLines = parseDetails(product.details).filter((row) => row.value)

  // Read straight from the browser's note each render — no state to keep in
  // step when the shopper switches size.
  const joined = Boolean(activeSize && hasJoined(product.id, activeSize))

  const chart = product.sizeChart
  const hasChart = Boolean(chart?.columns?.length && chart?.rows?.length)
  const chartNotes = (chart?.notes || []).map((n) => n.trim()).filter(Boolean)

  // Nothing to buy: every size sold out, or the size picked is.
  const allOut = availableSizes(product).length === 0
  const unavailable = allOut || Boolean(activeSize && isSoldOut(product, activeSize))
  const inCartCount = items.filter((i) => i.id === product.id).reduce((sum, i) => sum + i.qty, 0)

  const onList = Boolean(activeSize && (wishDone === activeSize || joined))

  // Opening the box is the whole job of the button; once a size is picked the
  // email field takes focus so the shopper can just type.
  function handleNotifyClick() {
    if (onList) return
    setNotifyOpen((open) => !open)
  }

  const ratings = reviews.map((r) => r.rating)
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
              <div className="shot" key={img} onClick={() => setZoom(i)} role="button" tabIndex={0} aria-label={`View photo ${i + 1} full screen`} onKeyDown={(e) => { if (e.key === 'Enter') setZoom(i) }}>
                <ShimmerImage
                  src={imgUrl(img, { w: 1400, q: 82 })}
                  alt={`${product.name} — view ${i + 1}`}
                  loading={i > 1 ? 'lazy' : undefined}
                />
              </div>
            ))}
          </div>

          {/* Phone only, over the photo: ‹ › at its sides and a thin line of
              blocks along its bottom, one per photo, the showing one solid —
              so it's clear there are more to swipe through. A block tapped
              jumps to that photo. */}
          {product.images.length > 1 && (
            <div className="rail-nav">
              <button
                className="rail-arrow prev"
                onClick={() => stepShot(-1)}
                disabled={shot === 0}
                aria-label="Previous photo"
              >
                ‹
              </button>
              <button
                className="rail-arrow next"
                onClick={() => stepShot(1)}
                disabled={shot >= product.images.length - 1}
                aria-label="Next photo"
              >
                ›
              </button>
              <div className="rail-bar" role="tablist" aria-label="Photos">
                {product.images.map((img, i) => (
                  <button
                    key={img}
                    role="tab"
                    aria-selected={i === shot}
                    aria-label={`Photo ${i + 1} of ${product.images.length}`}
                    className={i === shot ? 'on' : ''}
                    onClick={() => stepShot(i - shot)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sticks while the stills scroll past, so size and price stay reachable
            however many photos the product has. */}
        <aside className="info">
          {/* The name at the very top, SHARE on its line at the right. */}
          <div className="title-row">
            <h1 className="display">{product.name}</h1>
            <button type="button" className="share-btn mono" onClick={handleShare}>
              <IconShare width="15" height="15" strokeWidth="2.2" />
              {shared ? 'LINK COPIED' : 'SHARE'}
            </button>
          </div>
          <ProductPrice product={product} />
          {/* Only a member (signed in, inside the early window) or the admin
              can see a product before its launch time — say so. */}
          {isScheduled(product) && (
            <div className="early-tag mono">
              MEMBERS' EARLY ACCESS · OPENS TO EVERYONE {launchLabel(product.publish_at).toUpperCase()}
            </div>
          )}
          <p className="desc">{product.description}</p>

          {/* The colours, under the name and price and above size and add to
              cart. The colour showing has its name under its photo — when the
              admin gave it one. */}
          {colours.length > 1 && (
            <div className="colours">
              <div className="field-label mono">COLOUR</div>
              <div className="colour-row">
                {colours.map((c) => {
                  const on = c.id === product.id
                  return (
                    <div className={`colour-opt ${on ? 'on' : ''}`} key={c.id}>
                      <Link
                        to={`/product/${c.id}`}
                        className={`colour-chip ${on ? 'on' : ''}`}
                        title={c.variant || undefined}
                        aria-label={c.variant || `Colour ${c.id}`}
                      >
                        {c.images?.[0] && <ShimmerImage src={imgUrl(c.images[0], { w: 160 })} alt={c.variant || ''} />}
                      </Link>
                      {on && product.variant && <span className="colour-name mono">{product.variant}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="field-label mono">SIZE</div>
          <div className={`sizes ${needSize && !activeSize ? 'want' : ''}`}>
            {product.sizes.map((s) => {
              const out = isSoldOut(product, s)

              return (
                <button
                  type="button"
                  key={s}
                  className={`size-opt ${out ? 'disabled' : ''} ${activeSize === s ? 'active' : ''}`}
                  aria-pressed={activeSize === s}
                  title={out ? `${s} — sold out, tap to be notified` : s}
                  onClick={() => {
                    setActiveSize(s)
                    setWishState('idle')
                    setNeedSize(false)
                  }}
                >
                  {s}
                </button>
              )
            })}
            {/* Anything struck off by hand that was never in the size list. */}
            {soldOutSizes(product)
              .filter((s) => !product.sizes.includes(s))
              .map((s) => (
                <button type="button" key={s} className="size-opt disabled" disabled>{s}</button>
              ))}
          </div>
          {needSize && !activeSize && (
            <div className="need-size mono" role="alert">Select a size first.</div>
          )}

          {/* Nothing to buy here, so the button becomes the way to ask for it
              back: it opens the email box below. */}
          <button
            ref={addRef}
            className={`add-cart mono ${unavailable ? 'notify' : ''} ${onList ? 'listed' : ''}`}
            onClick={unavailable ? handleNotifyClick : () => handleAddToCart()}
            aria-expanded={unavailable ? notifyOpen : undefined}
          >
            {onList
              ? "You're on the list ✓"
              : unavailable
                ? 'Notify me when available'
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
              actually make more of. Hidden until the button is pressed, and
              gone again once the shopper is on the list. */}
          {unavailable && notifyOpen && !onList && (
            <div className="wish" ref={wishRef}>
              {!activeSize ? (
                <div className="wish-alert mono">Select your size from above.</div>
              ) : (
                <form onSubmit={handleWishlist}>
                  <div className="wish-head mono">EMAIL ME WHEN {activeSize} IS BACK</div>
                  <div className="wish-row">
                    <input
                      type="email"
                      value={wishEmail}
                      onChange={(e) => setWishEmail(e.target.value)}
                      // Signed in, the wishlist only accepts the account's
                      // own email (see supabase-migration-security-audit.sql).
                      readOnly={!!accountEmail}
                      placeholder="you@example.com"
                      aria-label="Your email address"
                    />
                    <button type="submit" className="mono" disabled={wishState === 'saving'}>
                      {wishState === 'saving' ? '…' : 'DONE'}
                    </button>
                  </div>
                  <div className={`wish-note mono ${wishState === 'error' ? 'bad' : ''}`}>
                    {wishState === 'error'
                      ? "That didn't go through — check the address and try again."
                      : 'One email, only for this size. Nothing else.'}
                  </div>
                </form>
              )}
            </div>
          )}
          {/* Not tied to the "Added" flash on the button: that clears after a
              moment, and a link that vanishes before it can be reached is no
              use. This stays for as long as the product is in the cart. */}
          {inCartCount > 0 && (
            <Link to="/cart" className="view-cart">
              <span>{inCartCount} in your cart</span>
              <span className="view-cart-go">View cart →</span>
            </Link>
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

          <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
        </aside>
      </div>

      <div className="reviews-section">
        <div className="reviews-head">
          <h2 className="display">Reviews</h2>
          <button
            type="button"
            className={`reviews-toggle mono ${showReviews ? 'on' : ''}`}
            onClick={() => setShowReviews((v) => !v)}
            aria-expanded={showReviews}
            aria-label={`${showReviews ? 'Hide' : 'Show'} reviews (${reviews.length})`}
          >
            <IconChat width="17" height="17" />
            <span className="reviews-count">{reviews.length}</span>
          </button>
          {/* The form stays out of the way until someone wants to write one. */}
          <button
            type="button"
            className={`reviews-toggle mono ${writing ? 'on' : ''}`}
            onClick={() => setWriting((v) => !v)}
            aria-expanded={writing}
            aria-label={writing ? 'Close the review form' : 'Write a review'}
            title="Write a review"
          >
            <IconPen width="16" height="16" />
            <span className="reviews-count">WRITE</span>
          </button>
          {ratings.length > 0 && (
            <div className="reviews-avg mono">
              {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}
              <span className="reviews-avg-detail"> {avgRating.toFixed(1)} · {ratings.length} review{ratings.length === 1 ? '' : 's'}</span>
            </div>
          )}
        </div>

        {showReviews && (
          <ul className="reviews-list">
            {reviews.length === 0 && (
              <li className="reviews-empty mono">No reviews yet — be the first.</li>
            )}
            {reviews.map((r) => (
              <li key={r.id} className="review-item">
                <div className="review-item-top">
                  <span className="review-name">{r.customer_name}</span>
                  <span className="review-stars mono">
                    {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                  </span>
                </div>
                {r.comment && <p className="review-text">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}

        {writing && (
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
            rows={2}
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
        )}
      </div>

      {/* Where the bottom bar stops: reaching "You may like". */}
      <div ref={endRef} aria-hidden="true" />
      <YouMayLike currentId={product.id} />

      <div className={`buy-bar ${barOn ? 'on' : ''}`} aria-hidden={!barOn} inert={barOn ? undefined : ''}>
        {barPick && (
          <div className="buy-sizes">
            {product.sizes.map((s) => {
              const out = isSoldOut(product, s)
              return (
                <button
                  type="button"
                  key={s}
                  className={`buy-size mono ${out ? 'out' : ''} ${activeSize === s ? 'on' : ''}`}
                  onClick={() => {
                    setActiveSize(s)
                    setWishState('idle')
                    setNeedSize(false)
                    setBarPick(false)
                    // Picking a size here is the add — one tap, not two.
                    if (!out) handleAddToCart(s)
                  }}
                >
                  {s}
                </button>
              )
            })}
          </div>
        )}
        <div className="buy-row">
          {product.images?.[0] && (
            <img className="buy-thumb" src={imgUrl(product.images[0], { w: 120 })} alt="" />
          )}
          <div className="buy-what">
            <span className="buy-name">{product.name}</span>
            <span className="buy-price mono">৳ {Number(product.price).toLocaleString()}</span>
          </div>
          {activeSize && (
            <button type="button" className="buy-chosen mono" onClick={() => setBarPick((v) => !v)} aria-label="Change size">
              {activeSize} <span aria-hidden="true">▾</span>
            </button>
          )}
          <button
            type="button"
            className={`buy-go mono ${justAdded ? 'done' : ''}`}
            disabled={onList}
            onClick={() => {
              if (!activeSize) return setBarPick((v) => !v)
              if (isSoldOut(product, activeSize)) {
                // The email box lives under the page's own button.
                addRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                if (!notifyOpen) handleNotifyClick()
                return
              }
              handleAddToCart()
            }}
          >
            {onList
              ? 'ON THE LIST ✓'
              : !activeSize
                ? 'SELECT SIZE'
                : isSoldOut(product, activeSize)
                  ? 'NOTIFY ME'
                  : justAdded
                    ? 'ADDED ✓'
                    : 'ADD TO CART'}
          </button>
        </div>
        {capped && <div className="buy-note mono">That's every piece we have left in {activeSize}.</div>}
      </div>
      <RecentlyViewed currentId={product.id} />

      {zoom !== null && (
        <Lightbox images={product.images} start={zoom} alt={product.name} onClose={closeZoom} />
      )}

      {sheet === 'details' && (
        <Sheet eyebrow="DETAILS" title={product.name} onClose={() => setSheet(null)}>
          <div className="sheet-table-wrap">
            <ul className="detail-list">
              {detailLines.map((row, i) => (
                <li key={i}>{row.value}</li>
              ))}
            </ul>
          </div>
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
