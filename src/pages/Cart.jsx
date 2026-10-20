import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { useCart } from '../context/CartContext.jsx'
import { imgUrl } from '../lib/images.js'
import { fetchProducts } from '../lib/products.js'
import { isSoldOut } from '../lib/stock.js'
import ShimmerImage from '../components/ShimmerImage.jsx'
import usePageMeta from '../lib/usePageMeta.js'
import './cart.css'

export default function Cart() {
  const { items, updateQty, removeItem, changeSize, addSizeLine, subtotal, refreshPrices } = useCart()
  const navigate = useNavigate()
  usePageMeta('Cart')

  useEffect(() => {
    refreshPrices()
  }, [refreshPrices])

  // The products in the cart, for their sizes and what's left of each — so a
  // line's size can be changed here, or the same piece added in another size.
  const [products, setProducts] = useState([])
  useEffect(() => {
    fetchProducts().then(({ products }) => setProducts(products || []))
  }, [])
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products])

  return (
    <>
      <Nav />

      <div className="cart-page">
        <div className="section-head">
          <div>
            <div className="label mono">QUEUE</div>
            <h2 className="display">Your Cart</h2>
          </div>
          <div className="label mono">{items.length} ITEM{items.length !== 1 ? 'S' : ''}</div>
        </div>

        {items.length === 0 ? (
          <div className="empty-cart">
            <p className="mono">Queue is empty.</p>
            <Link to="/" className="back-link mono">← BACK TO SHOP</Link>
          </div>
        ) : (
          <div className="cart-body">
            <div className="cart-lines">
              {items.map((item) => {
                const p = byId[String(item.id)]
                const sizes = p?.sizes?.length ? p.sizes : null
                // Sizes of this piece not in the cart yet that can still be bought.
                const inCart = items.filter((i) => i.id === item.id).map((i) => i.size)
                const free = sizes ? sizes.filter((s) => !inCart.includes(s) && !isSoldOut(p, s)) : []
                const lastOfPiece = items.filter((i) => i.id === item.id).at(-1) === item
                return (
                <div className="cart-line" key={`${item.id}-${item.size}`}>
                  <Link to={`/product/${item.id}`} className="line-thumb">
                    <ShimmerImage src={imgUrl(item.image, { w: 200 })} alt={item.name} />
                  </Link>

                  <div className="line-info">
                    <div className="line-sku mono">{item.sku}</div>
                    <Link to={`/product/${item.id}`} className="line-name">{item.name}</Link>
                    {sizes ? (
                      <div className="line-sizes mono" role="radiogroup" aria-label={`Size of ${item.name}`}>
                        {sizes.map((s) => {
                          const out = isSoldOut(p, s) && s !== item.size
                          return (
                            <button
                              key={s}
                              type="button"
                              role="radio"
                              aria-checked={s === item.size}
                              className={`line-size-opt ${s === item.size ? 'on' : ''}`}
                              disabled={out}
                              title={out ? 'Sold out' : inCart.includes(s) && s !== item.size ? 'Already in your cart — they join up' : ''}
                              onClick={() => changeSize(item.id, item.size, s)}
                            >
                              {s}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="line-size mono">SIZE {item.size}</div>
                    )}
                    {lastOfPiece && free.length > 0 && (
                      <button type="button" className="line-more mono" onClick={() => addSizeLine(item.id, free[0])}>
                        + Another size
                      </button>
                    )}
                  </div>

                  <div className="line-qty">
                    <button
                      onClick={() => updateQty(item.id, item.size, item.qty - 1)}
                      aria-label="Fewer"
                    >
                      −
                    </button>
                    <span className="mono">{item.qty}</span>
                    <button
                      onClick={() => updateQty(item.id, item.size, item.qty + 1)}
                      aria-label="More"
                    >
                      +
                    </button>
                  </div>

                  <div className="line-price mono">৳ {(item.price * item.qty).toLocaleString()}</div>

                  <button
                    className="line-remove"
                    onClick={() => removeItem(item.id, item.size)}
                    aria-label={`Remove ${item.name}`}
                  >
                    ✕
                  </button>
                </div>
                )
              })}
            </div>

            <div className="cart-summary">
              <div className="summary-title mono">ORDER SUMMARY</div>

              <div className="summary-row mono">
                <span>SUBTOTAL</span>
                <span>৳ {subtotal.toLocaleString()}</span>
              </div>
              <div className="summary-row mono steel">
                <span>DELIVERY</span>
                <span>Calculated at checkout</span>
              </div>
              <div className="summary-row mono total">
                <span>TOTAL</span>
                <span>৳ {subtotal.toLocaleString()}</span>
              </div>

              <button className="checkout-btn mono" onClick={() => navigate('/checkout')}>
                Proceed to checkout
              </button>
              <div className="cod-note mono">Cash on delivery — outside Dhaka needs a ৳200 bKash advance</div>
              <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
