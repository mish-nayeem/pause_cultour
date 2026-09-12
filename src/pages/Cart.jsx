import { Link, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { useCart } from '../context/CartContext.jsx'
import './cart.css'

export default function Cart() {
  const { items, updateQty, removeItem, subtotal } = useCart()
  const navigate = useNavigate()

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
                  <div className="line-thumb">
                    <img src={item.image} alt={item.name} />
                  </div>
                  <div className="line-info">
                    <div className="line-sku mono">{item.sku}</div>
                    <div className="line-name">{item.name}</div>
                    <div className="line-size mono">SIZE {item.size}</div>
                  </div>
                  <div className="line-qty">
                    <button onClick={() => updateQty(item.id, item.size, item.qty - 1)}>−</button>
                    <span className="mono">{item.qty}</span>
                    <button onClick={() => updateQty(item.id, item.size, item.qty + 1)}>+</button>
                  </div>
                  <div className="line-price mono">৳ {(item.price * item.qty).toLocaleString()}</div>
                  <button
                    className="line-remove mono"
                    onClick={() => removeItem(item.id, item.size)}
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="cart-summary">
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
              <div className="cod-note mono">Cash on delivery only — pay when it arrives</div>
              <Link to="/" className="back-link mono">← BACK TO SHOP</Link>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
