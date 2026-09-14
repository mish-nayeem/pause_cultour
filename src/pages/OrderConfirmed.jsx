import { useLocation, Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import './order-confirmed.css'

export default function OrderConfirmed() {
  const location = useLocation()
  const order = location.state?.order

  if (!order) {
    return (
      <>
        <Nav />
        <div className="confirm-page">
          <p className="mono">No recent order found.</p>
          <Link to="/" className="back-link mono">← BACK TO SHOP</Link>
        </div>
      </>
    )
  }

  return (
    <>
      <Nav />
      <div className="confirm-page">
        <div className="confirm-badge mono"><span className="dot"></span> ORDER RECORDED</div>
        <h1 className="display">Order placed.</h1>
        <p className="confirm-sub mono">ORDER ID: {order.orderId}</p>

        <div className="receipt">
          {order.items.map((item) => (
            <div className="receipt-line mono" key={`${item.id}-${item.size}`}>
              <span>{item.name} × {item.qty} <span className="steel">({item.size})</span></span>
              <span>৳ {(item.price * item.qty).toLocaleString()}</span>
            </div>
          ))}
          <div className="receipt-row mono total">
            <span>TOTAL (COD)</span>
            <span>৳ {order.subtotal.toLocaleString()}</span>
          </div>
        </div>

        <div className="deliver-to">
          <div className="field-label mono">DELIVERING TO</div>
          <p>{order.customer.name} · {order.customer.phone}</p>
          <p>{order.customer.address}, {order.customer.area}</p>
          {order.customer.note && <p className="steel">Note: {order.customer.note}</p>}
        </div>

        <p className="confirm-note mono">Pay in cash when your order arrives. We'll call to confirm before delivery.</p>

        {/* Right after checkout is when the order number is in front of them,
            so this is the best moment to hand over the tracking link. */}
        <Link to={`/track?id=${order.orderId}`} className="track-cta mono">
          Track this order →
        </Link>

        <Link to="/" className="back-link mono">← BACK TO SHOP</Link>
      </div>
    </>
  )
}
