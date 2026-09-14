import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { trackOrder } from '../lib/tracking.js'
import usePageMeta from '../lib/usePageMeta.js'
import './track.css'

// The happy path, in order. Cancelled is handled separately because it isn't a
// stage — it ends the sequence wherever it happened.
const STAGES = [
  { key: 'pending', label: 'Order placed', note: "We've got your order and we're packing it." },
  { key: 'shipped', label: 'On the way', note: 'Your parcel has left us. Keep the cash ready.' },
  { key: 'delivered', label: 'Delivered', note: 'Delivered and paid. Thanks for shopping with us.' },
]

function taka(n) {
  return '৳ ' + Number(n).toLocaleString()
}

export default function Track() {
  const [params] = useSearchParams()
  const [orderId, setOrderId] = useState(params.get('id') || '')
  const [phone, setPhone] = useState('')
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  usePageMeta('Track your order')

  async function handleSubmit(e) {
    e.preventDefault()

    if (!orderId.trim() || !phone.trim()) {
      setError('Enter your order number and the phone number you ordered with.')
      return
    }

    setLoading(true)
    setError('')
    setOrder(null)

    const { order, error } = await trackOrder(orderId.trim(), phone.trim())

    setLoading(false)
    if (error) setError(error)
    else setOrder(order)
  }

  const cancelled = order?.status === 'cancelled'
  const stageIndex = order ? STAGES.findIndex((s) => s.key === order.status) : -1

  return (
    <>
      <Nav />

      <div className="track-page">
        <div className="track-head">
          <div className="label mono">SUPPORT</div>
          <h1 className="display">Track your order</h1>
          <p className="track-intro">
            Enter your order number and the phone number you ordered with. Your
            order number starts with PC and is in the confirmation email.
          </p>
        </div>

        <form className="track-form" onSubmit={handleSubmit}>
          <label className="tf-field">
            <span className="mono">ORDER NUMBER</span>
            <input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value.toUpperCase())}
              placeholder="PC123456"
            />
          </label>

          <label className="tf-field">
            <span className="mono">PHONE NUMBER</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="017XXXXXXXX"
            />
          </label>

          <button type="submit" className="tf-btn mono" disabled={loading}>
            {loading ? 'Checking…' : 'Track order'}
          </button>
        </form>

        {error && <div className="track-error mono">{error}</div>}

        {order && (
          <div className="track-result">
            <div className="tr-head">
              <div>
                <div className="tr-id mono">{order.id}</div>
                <div className="tr-name">{order.name}</div>
              </div>
              <div className="tr-total mono">{taka(order.subtotal)}</div>
            </div>

            {cancelled ? (
              <div className="tr-cancelled mono">
                This order was cancelled. Nothing has been charged. If that
                wasn't expected, <Link to="/contact">get in touch</Link>.
              </div>
            ) : (
              <div className="timeline">
                {STAGES.map((stage, i) => {
                  const done = i <= stageIndex
                  const current = i === stageIndex
                  return (
                    <div className={`tl-step ${done ? 'done' : ''} ${current ? 'now' : ''}`} key={stage.key}>
                      <div className="tl-dot" />
                      <div className="tl-body">
                        <div className="tl-label">{stage.label}</div>
                        {current && <div className="tl-note">{stage.note}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="tr-items">
              <div className="label mono">ITEMS</div>
              {order.items.map((it, i) => (
                <div className="tr-item" key={i}>
                  <span>{it.product_name} · {it.size} × {it.qty}</span>
                  <span className="mono">{taka(it.price * it.qty)}</span>
                </div>
              ))}
            </div>

            <div className="tr-foot mono">
              Delivering to {order.area} · Cash on delivery
            </div>
          </div>
        )}

        <Link to="/contact" className="back-link mono">Need help? Contact us →</Link>
      </div>

      <Footer />
    </>
  )
}
