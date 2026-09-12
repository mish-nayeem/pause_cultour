import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { products } from '../data/products.js'
import { useCart } from '../context/CartContext.jsx'
import './product.css'

export default function Product() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { addItem } = useCart()
  const product = products.find((p) => p.id === id) || products[0]
  const [activeImg, setActiveImg] = useState(0)
  const [activeSize, setActiveSize] = useState(product.sizes[0])
  const [justAdded, setJustAdded] = useState(false)

  function handleAddToCart() {
    addItem(product, activeSize, 1)
    setJustAdded(true)
    setTimeout(() => setJustAdded(false), 1600)
  }

  return (
    <>
      <Nav />

      <div className="crumb mono">
        SHOP / {product.drop} / <span>{product.name.toUpperCase()}</span>
      </div>

      <div className="pdp">
        <div className="media">
          <div className="main-frame">
            <img src={product.images[activeImg]} alt={product.name} />
            <div className="frame-badge mono"><span className="dot"></span> FRAME 00214 / PAUSED</div>
            <div className="play-static">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 4L20 12L6 20V4Z" fill="#EDEAE1" fillOpacity="0.9" />
              </svg>
            </div>
            <div className="mini-scrub">
              <div className="mini-track">
                <div
                  className="mini-fill"
                  style={{ width: `${((activeImg + 1) / product.images.length) * 100}%` }}
                ></div>
              </div>
              <div className="mini-meta mono">
                <span>SCENE {String(activeImg + 1).padStart(2, '0')} / {String(product.images.length).padStart(2, '0')}</span>
              </div>
            </div>
          </div>
          <div className="thumbs">
            {product.images.map((img, i) => (
              <div
                key={img}
                className={`t ${i === activeImg ? 'active' : ''}`}
                onClick={() => setActiveImg(i)}
              >
                <img src={img} alt="" />
              </div>
            ))}
          </div>
        </div>

        <div className="info">
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

          <Link to="/" className="back-link mono">← BACK TO SHOP</Link>
        </div>
      </div>
    </>
  )
}
