import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { useCart } from '../context/CartContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import './checkout.css'

export default function Checkout() {
  const { items, subtotal, clearCart } = useCart()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    area: '',
    note: '',
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  if (items.length === 0) {
    return (
      <>
        <Nav />
        <div className="empty-cart">
          <p className="mono">Your cart is empty — nothing to check out.</p>
          <Link to="/" className="back-link mono">← BACK TO SHOP</Link>
        </div>
      </>
    )
  }

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!/^01[3-9]\d{8}$/.test(form.phone.trim())) errs.phone = 'Enter a valid Bangladeshi number (e.g. 017XXXXXXXX)'
    if (!form.address.trim()) errs.address = 'Address is required'
    if (!form.area.trim()) errs.area = 'City / area is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return

    setSubmitting(true)
    setSubmitError('')

    const orderId = 'PZ' + Math.floor(100000 + Math.random() * 900000)

    const { error: orderError } = await supabase.from('orders').insert({
      id: orderId,
      customer_name: form.name,
      customer_phone: form.phone,
      customer_address: form.address,
      customer_area: form.area,
      customer_note: form.note || null,
      subtotal,
    })

    if (orderError) {
      setSubmitting(false)
      setSubmitError('Could not place your order — please check your connection and try again.')
      console.error('[Supabase] order insert failed:', orderError.message)
      return
    }

    const orderItemsPayload = items.map((item) => ({
      order_id: orderId,
      product_id: item.id,
      product_name: item.name,
      size: item.size,
      price: item.price,
      qty: item.qty,
    }))

    const { error: itemsError } = await supabase.from('order_items').insert(orderItemsPayload)

    if (itemsError) {
      // Order row exists but items failed — still let the customer see confirmation,
      // since the order itself was recorded. Log it for manual follow-up.
      console.error('[Supabase] order_items insert failed:', itemsError.message)
    }

    const order = {
      orderId,
      items,
      subtotal,
      customer: form,
      placedAt: new Date().toISOString(),
    }

    setSubmitting(false)
    clearCart()
    navigate('/order-confirmed', { state: { order } })
  }

  return (
    <>
      <Nav />

      <div className="checkout-page">
        <div className="section-head">
          <div>
            <div className="label mono">FINAL STEP</div>
            <h2 className="display">Checkout</h2>
          </div>
        </div>

        <div className="checkout-body">
          <form className="checkout-form" onSubmit={handleSubmit} noValidate>
            <div className="field-label mono">DELIVERY DETAILS</div>

            <label className="field">
              <span className="mono">Full name</span>
              <input name="name" value={form.name} onChange={handleChange} placeholder="Your name" />
              {errors.name && <em className="err mono">{errors.name}</em>}
            </label>

            <label className="field">
              <span className="mono">Phone number</span>
              <input name="phone" value={form.phone} onChange={handleChange} placeholder="017XXXXXXXX" />
              {errors.phone && <em className="err mono">{errors.phone}</em>}
            </label>

            <label className="field">
              <span className="mono">Full address</span>
              <textarea name="address" value={form.address} onChange={handleChange} placeholder="House, road, area details" rows={3} />
              {errors.address && <em className="err mono">{errors.address}</em>}
            </label>

            <label className="field">
              <span className="mono">City / area</span>
              <input name="area" value={form.area} onChange={handleChange} placeholder="e.g. Dhanmondi, Dhaka" />
              {errors.area && <em className="err mono">{errors.area}</em>}
            </label>

            <label className="field">
              <span className="mono">Delivery note (optional)</span>
              <textarea name="note" value={form.note} onChange={handleChange} placeholder="Landmark, preferred time, etc." rows={2} />
            </label>

            <div className="payment-note mono">
              <span className="dot"></span> PAYMENT METHOD: CASH ON DELIVERY
            </div>

            {submitError && <em className="err mono" style={{ display: 'block', marginBottom: '14px' }}>{submitError}</em>}

            <button type="submit" className="place-order mono" disabled={submitting}>
              {submitting ? 'Placing order…' : 'Place order'}
            </button>
          </form>

          <div className="order-summary">
            <div className="label mono" style={{ marginBottom: '18px' }}>ORDER SUMMARY</div>
            {items.map((item) => (
              <div className="summary-line mono" key={`${item.id}-${item.size}`}>
                <span>{item.name} × {item.qty} <span className="steel">({item.size})</span></span>
                <span>৳ {(item.price * item.qty).toLocaleString()}</span>
              </div>
            ))}
            <div className="summary-row mono total">
              <span>TOTAL</span>
              <span>৳ {subtotal.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
