import { Link, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { useCart } from '../context/CartContext.jsx'
import { cld } from '../lib/cloudinary.js'
import usePageMeta from '../lib/usePageMeta.js'
import './cart.css'

export default function Cart() {
  const { items, updateQty, removeItem, subtotal } = useCart()
  const navigate = useNavigate()
  usePageMeta('Cart')

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
              {items.map((item) => (
                <div className="cart-line" key={`${item.id}-${item.size}`}>
                  <Link to={`/product/${item.id}`} className="line-thumb">
                    <img src={cld(item.image, { w: 200 })} alt={item.name} />
                  </Link>

                  <div className="line-info">
                    <div className="line-sku mono">{item.sku}</div>
                    <Link to={`/product/${item.id}`} className="line-name">{item.name}</Link>
                    <div className="line-size mono">SIZE {item.size}</div>
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
              ))}
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
