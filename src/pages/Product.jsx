import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchProductById } from '../lib/products.js'
import { cld } from '../lib/cloudinary.js'
import { useCart } from '../context/CartContext.jsx'
import './product.css'

export default function Product() {
  const { id } = useParams()
  const { addItem } = useCart()

  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [activeSize, setActiveSize] = useState(null)
  const [justAdded, setJustAdded] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setNotFound(false)
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

  return (
    <>
      <Nav />

      <div className="crumb mono">
        <Link to="/shop">SHOP</Link> / {product.drop} / <span>{product.name.toUpperCase()}</span>
      </div>

      <div className="pdp">
        {/* Every image stacked full width — the page scroll is the gallery, so
            there's no carousel to click through. */}
        <div className="media">
          {product.images.map((img, i) => (
            <div className="shot" key={img}>
              <img src={cld(img, { w: 1000 })} alt={`${product.name} ${i + 1}`} />
              {i === 0 && (
                <div className="frame-tag mono">
                  <span className="dot" /> FRAME {String(i + 1).padStart(5, '0')} / PAUSED
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Sticks while the images scroll past, so size and price stay reachable
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

          <div className="spec-list">
            {product.specs.map((row) => (
              <div className="spec-row mono" key={row.k}>
                <span className="k">{row.k}</span>
                <span>{row.v}</span>
              </div>
            ))}
          </div>

          <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
        </aside>
      </div>

      <Footer />
    </>
  )
}
