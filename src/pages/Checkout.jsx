import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { useCart } from '../context/CartContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { sendOrderConfirmation } from '../lib/email.js'
import { getAttribution } from '../lib/attribution.js'
import { saveAbandonedCart, markCartConverted } from '../lib/abandonedCart.js'
import { BKASH_NUMBER, DISTRICTS, quote, isTrxId, cleanTrxId } from '../lib/delivery.js'
import usePageMeta from '../lib/usePageMeta.js'
import { Sentry } from '../lib/sentry.js'
import './checkout.css'

function money(n) {
  return '৳ ' + Number(n).toLocaleString()
}

// place_order raises a tagged message for the cases the customer can act on,
// so each one comes back as something worth reading instead of a database
// error. Anything else is treated as a failed request.
function orderMessage(error) {
  const raw = error.message || ''

  const soldOut = raw.match(/SOLD_OUT:(.*):(.*)/)
  if (soldOut) {
    return `${soldOut[1]} in size ${soldOut[2]} just sold out — please remove it from your cart and try again.`
  }

  const gone = raw.match(/UNAVAILABLE:(.*)/)
  if (gone) {
    return `${gone[1]} is no longer available — please remove it from your cart.`
  }

  // place_order checks every price against the products table — a cart saved
  // before a price change is the honest way to land here.
  const priceChanged = raw.match(/PRICE_CHANGED:(.*)/)
  if (priceChanged) {
    return `The price of ${priceChanged[1]} has changed — please remove it from your cart and add it again.`
  }

  if (raw.includes('TRX_REQUIRED')) {
    return 'Please enter the bKash Transaction ID for your advance payment.'
  }

  if (raw.includes('PRICE_MISMATCH') || raw.includes('INVALID_QTY')) {
    return 'Your cart total is out of date — please refresh the page and try again.'
  }

  // The unique index on the transaction id: this bKash receipt is already on
  // another order.
  if (error.code === '23505' || raw.includes('orders_advance_trx_id_idx')) {
    return 'That transaction ID has already been used on another order.'
  }

  if (raw.includes('RATE_LIMITED')) {
    return "You've placed a few orders in a short time — please wait a few minutes and try again."
  }

  return 'Could not place your order — please check your connection and try again.'
}

export default function Checkout() {
  const { items, subtotal, clearCart } = useCart()
  const navigate = useNavigate()
  usePageMeta('Checkout')
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    district: '',
    note: '',
    trxId: '',
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [copied, setCopied] = useState(false)

  // Debounced so this doesn't fire on every keystroke — the admin panel's
  // Abandoned Cart list is for spotting a checkout that stalled, not a
  // live feed, so a couple of seconds' lag costs nothing.
  useEffect(() => {
    if (items.length === 0) return

    const t = setTimeout(() => {
      saveAbandonedCart({ name: form.name, phone: form.phone, items, cartValue: subtotal })
    }, 2000)

    return () => clearTimeout(t)
  }, [items, form.name, form.phone, subtotal])

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

  // The district decides everything below it: the delivery charge, whether an
  // advance is owed, and how much the rider still collects.
  const bill = quote(subtotal, form.district)
  const needsAdvance = bill.advance > 0

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  function pickDistrict(e) {
    const district = e.target.value

    // Switching back to a district with no advance drops whatever was typed in
    // the transaction box, so a stale id can never ride along with the order.
    setForm((prev) => ({
      ...prev,
      district,
      trxId: district && district !== 'Dhaka' ? prev.trxId : '',
    }))
    setErrors((prev) => ({ ...prev, district: undefined, trxId: undefined }))
  }

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(BKASH_NUMBER)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be blocked; the number is on screen to be typed.
    }
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!/^01[3-9]\d{8}$/.test(form.phone.trim())) errs.phone = 'Enter a valid Bangladeshi number (e.g. 017XXXXXXXX)'
    // The confirmation, and every status mail after it, go to this address, so
    // the order isn't taken without one.
    if (!form.email.trim()) {
      errs.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
      errs.email = 'Enter a valid email address'
    }
    if (!form.address.trim()) errs.address = 'Address is required'
    if (!form.district) errs.district = 'Select your district'

    // Outside Dhaka the advance is the order — without a transaction id there
    // is nothing to check against bKash, so the order isn't accepted.
    if (needsAdvance) {
      if (!form.trxId.trim()) {
        errs.trxId = 'Send the advance first, then enter the transaction ID'
      } else if (!isTrxId(form.trxId)) {
        errs.trxId = 'That does not look like a bKash transaction ID (e.g. K8H7G6F5D4)'
      }
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return

    setSubmitting(true)
    setSubmitError('')

    const trxId = needsAdvance ? cleanTrxId(form.trxId) : null
    const attribution = getAttribution()

    // One call, one transaction: the order, its lines and the stock coming off
    // each size either all happen or none do. Two people reaching for the last
    // piece of a size means the second one is turned away here rather than
    // both being sold it. The order id itself is generated inside place_order
    // now, not here — a client-made-up id was guessable, see
    // supabase-migration-secure-order-id.sql.
    const { data: orderId, error: orderError } = await supabase.rpc('place_order', {
      payload: {
        order: {
          id_prefix: 'PC',
          customer_name: form.name,
          customer_phone: form.phone,
          customer_email: form.email.trim() || null,
          customer_address: form.address,
          customer_area: form.district,
          customer_note: form.note || null,
          subtotal,
          delivery_zone: bill.zone.key,
          delivery_fee: bill.fee,
          total: bill.total,
          advance_amount: bill.advance,
          advance_method: needsAdvance ? 'bkash' : null,
          advance_trx_id: trxId,
          utm_source: attribution.utm_source || null,
          utm_medium: attribution.utm_medium || null,
          utm_campaign: attribution.utm_campaign || null,
          utm_content: attribution.utm_content || null,
          utm_term: attribution.utm_term || null,
        },
        items: items.map((item) => ({
          product_id: item.id,
          product_name: item.name,
          size: item.size,
          price: item.price,
          qty: item.qty,
        })),
      },
    })

    if (orderError) {
      setSubmitting(false)
      setSubmitError(orderMessage(orderError))
      console.error('[Supabase] place_order failed:', orderError.message)
      // A failed checkout is caught and handled gracefully right here, so it
      // would never otherwise reach Sentry's automatic unhandled-error
      // capture — this is the one place a lost sale needs reporting by hand.
      Sentry.captureException(orderError, { tags: { flow: 'checkout' } })
      return
    }

    const order = {
      orderId,
      items,
      subtotal,
      delivery: {
        zone: bill.zone.key,
        zoneLabel: bill.zone.label,
        fee: bill.fee,
        total: bill.total,
        advance: bill.advance,
        due: bill.due,
        trxId,
      },
      customer: form,
      placedAt: new Date().toISOString(),
    }

    // Awaited so the confirmation page isn't reached before the mail is queued,
    // but this never throws — a mail failure can't block the order. Only the id
    // is sent; the function reads the order back from the database itself.
    await sendOrderConfirmation(orderId)
    await markCartConverted(orderId)

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
              <span className="mono">Full name <i className="req">*</i></span>
              <input name="name" value={form.name} onChange={handleChange} placeholder="Your name" />
              {errors.name && <em className="err mono">{errors.name}</em>}
            </label>

            <label className="field">
              <span className="mono">Phone number <i className="req">*</i></span>
              <input name="phone" value={form.phone} onChange={handleChange} placeholder="017XXXXXXXX" />
              {errors.phone && <em className="err mono">{errors.phone}</em>}
            </label>

            <label className="field">
              <span className="mono">Email <i className="req">*</i></span>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="you@example.com"
              />
              <em className="hint mono">We'll email your order confirmation here.</em>
              {errors.email && <em className="err mono">{errors.email}</em>}
            </label>

            {/* District sits above the address because it sets the delivery
                charge — the customer settles where before they write out
                exactly where. */}
            <label className="field">
              <span className="mono">District <i className="req">*</i></span>
              <select name="district" value={form.district} onChange={pickDistrict}>
                <option value="">Select District</option>
                {DISTRICTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {errors.district && <em className="err mono">{errors.district}</em>}
            </label>

            <label className="field">
              <span className="mono">Full address <i className="req">*</i></span>
              <textarea name="address" value={form.address} onChange={handleChange} placeholder="House, road, area details" rows={3} />
              {errors.address && <em className="err mono">{errors.address}</em>}
            </label>

            {/* Picked a district, so the charge is known — Dhaka shows its ৳80
                and everywhere else swaps it for the advance that has to be
                paid before the order is taken. */}
            {bill.zone && (
              <div className={`advance-head ${needsAdvance ? 'pay' : 'cod'}`}>
                <div>
                  <div className="advance-title mono">{bill.zone.title}</div>
                  <div className="advance-sub mono">{bill.zone.note}</div>
                </div>
                <div className="advance-amount">
                  {money(needsAdvance ? bill.advance : bill.fee)}
                </div>
              </div>
            )}

            {needsAdvance && (
              <div className="bkash-box">
                <div className="field-label mono" style={{ marginBottom: '14px' }}>BKASH PAYMENT</div>

                <div className="bkash-number">
                  <span>bKash Number</span>
                  <span className="bkash-digits mono">{BKASH_NUMBER}</span>
                  <button type="button" className="copy mono" onClick={copyNumber}>
                    {copied ? 'COPIED' : 'COPY'}
                  </button>
                </div>

                <ul className="bkash-steps mono">
                  <li>Dial *247# or open your bKash app</li>
                  <li>Select "Send Money"</li>
                  <li>Send {money(bill.advance)} to the number above</li>
                  <li>Enter the Transaction ID you receive by SMS below</li>
                </ul>

                <label className="field" style={{ marginBottom: 0 }}>
                  <span className="mono">Transaction ID <i className="req">*</i></span>
                  <input
                    name="trxId"
                    value={form.trxId}
                    onChange={handleChange}
                    placeholder="Type or paste your TrxID (e.g. K8H7G6F5D4)"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck="false"
                    aria-required="true"
                  />
                  {errors.trxId ? (
                    <em className="err mono">{errors.trxId}</em>
                  ) : (
                    <span className="trx-hint mono">
                      Required — copy it from the bKash SMS and paste it here. The order can't be placed without it.
                    </span>
                  )}
                </label>
              </div>
            )}

            <label className="field">
              <span className="mono">Delivery note (optional)</span>
              <textarea name="note" value={form.note} onChange={handleChange} placeholder="Landmark, preferred time, etc." rows={2} />
            </label>

            <div className="payment-note mono">
              <span className="dot"></span>
              {needsAdvance
                ? `ADVANCE ${money(bill.advance)} BY BKASH · ${money(bill.due)} CASH ON DELIVERY`
                : 'PAYMENT METHOD: CASH ON DELIVERY'}
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
            <div className="summary-row mono">
              <span>SUBTOTAL</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className={`summary-row mono ${form.zone ? '' : 'steel'}`}>
              <span>DELIVERY</span>
              <span>{form.zone ? money(bill.fee) : 'Pick a zone'}</span>
            </div>
            <div className="summary-row mono total">
              <span>TOTAL</span>
              <span>{money(bill.total)}</span>
            </div>

            {needsAdvance && (
              <div className="summary-split">
                <div className="summary-row mono">
                  <span>ADVANCE (BKASH)</span>
                  <span>− {money(bill.advance)}</span>
                </div>
                <div className="summary-row mono due">
                  <span>DUE ON DELIVERY</span>
                  <span>{money(bill.due)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
