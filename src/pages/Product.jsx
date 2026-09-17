import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchProductById, fetchColourOptions } from '../lib/products.js'
import { cld } from '../lib/cloudinary.js'
import { useCart } from '../context/CartContext.jsx'
import usePageMeta from '../lib/usePageMeta.js'
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
  const { addItem } = useCart()

  const [product, setProduct] = useState(null)
  const [colours, setColours] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [activeSize, setActiveSize] = useState(null)
  const [justAdded, setJustAdded] = useState(false)
  const [sheet, setSheet] = useState(null) // null | 'details' | 'sizes'
  const [shot, setShot] = useState(0)

  const galleryRef = useRef(null)

  usePageMeta(
    product?.name,
    product ? `${product.name} — ${product.variant}, ৳${product.price}. ${product.description}` : undefined
  )

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
        setActiveSize(product.sizes[0] || null)
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

  function handleAddToCart() {
    if (!product || !activeSize) return
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

  const chart = product.sizeChart
  const hasChart = Boolean(chart?.columns?.length && chart?.rows?.length)
  const chartNotes = (chart?.notes || []).map((n) => n.trim()).filter(Boolean)

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
                {i === 0 && (
                  <div className="frame-tag mono">
                    <span className="dot" /> FRAME {String(i + 1).padStart(5, '0')} / PAUSED
                  </div>
                )}
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
          <div className="code mono">{product.sku} · {product.variant.toUpperCase()}</div>
          <h1 className="display">{product.name}</h1>
          <div className="price mono">৳ {product.price.toLocaleString()}</div>
          <p className="desc">{product.description}</p>

          <div className="field-label mono">SIZE</div>
          <div className="sizes">
            {product.sizes.map((s) => (
              <div
                key={s}
                className={`size-opt ${activeSize === s ? 'active' : ''}`}
                onClick={() => setActiveSize(s)}
              >
                {s}
              </div>
            ))}
            {product.sizesOut.map((s) => (
              <div key={s} className="size-opt disabled">{s}</div>
            ))}
          </div>

          <button className="add-cart mono" onClick={handleAddToCart}>
            {justAdded ? 'Added to cart ✓' : 'Add to cart'}
          </button>
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
