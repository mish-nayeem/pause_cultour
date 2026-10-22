import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DEFAULT_PORTAL, EXCHANGE_FEE, EXCHANGE_REASONS, REFUND_REASONS, REFUND_WRONG_SIZE, exchangeIsFree, fetchPortal, findOrder, sendRequest } from '../lib/support.js'
import { imgUrl } from '../lib/images.js'
import './return-portal.css'

const REASONS = {
  exchange: EXCHANGE_REASONS,
  refund: REFUND_REASONS,
}

const STATUS_NOTE = {
  pending: "This order hasn't left us yet. Need a change? Contact us and we'll fix it before it ships.",
  shipped: "This order is on the way. Check it in front of the rider — refuse it if anything is wrong. Requests open once it's delivered.",
  cancelled: 'This order was cancelled, so there is nothing to return.',
  returned: 'This parcel came back to us before it reached you. To have it sent again, contact us.',
}

function taka(n) {
  return '৳ ' + Number(n).toLocaleString()
}

// Support → Return & Exchange Portal. Order number + the email or phone the
// order was placed with → the order's pieces → pick refund or exchange, the
// pieces and the reason → a request in Admin → Support.
export default function ReturnPortal() {
  // From My account → an order's Return / Exchange: the order and email
  // arrive in the link, and the order is looked up straight away.
  const [params] = useSearchParams()
  const [portal, setPortal] = useState(DEFAULT_PORTAL)
  const [orderId, setOrderId] = useState(() => (params.get('order') || '').toUpperCase())
  const [contact, setContact] = useState(() => params.get('contact') || '')
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [kind, setKind] = useState('exchange')
  const [picked, setPicked] = useState({}) // index → { on, exchange_size }
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  // A size exchange for the customer's own reason costs the second
  // parcel's delivery — they say they understand before sending.
  const [feeOk, setFeeOk] = useState(false)
  const [sent, setSent] = useState(null)

  useEffect(() => {
    fetchPortal().then(({ portal }) => setPortal(portal))
  }, [])

  useEffect(() => {
    if (orderId && contact) handleCheck()
    // Once, for the link's own values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCheck(e) {
    e?.preventDefault()
    if (!orderId.trim() || !contact.trim()) {
      setError('Enter your order number and the email or phone number you ordered with.')
      return
    }
    setBusy(true)
    setError('')
    setOrder(null)
    setSent(null)
    const { order, error } = await findOrder(orderId.trim(), contact.trim())
    setBusy(false)
    if (error) return setError(error)
    setOrder(order)
    setPicked(order.items.length === 1 ? { 0: { on: true, exchange_size: '' } } : {})
    setReason('')
    setDetails('')
  }

  function toggle(i, patch) {
    setPicked((prev) => ({ ...prev, [i]: { on: false, exchange_size: '', ...prev[i], ...patch } }))
    setError('')
  }

  // The size box shows for an exchange, and for a wrong-size refund.
  const needsSize = kind === 'exchange' || (kind === 'refund' && reason === REFUND_WRONG_SIZE)

  async function handleSend(e) {
    e.preventDefault()
    const items = order.items
      .map((it, i) => ({ it, p: picked[i] }))
      .filter(({ p }) => p?.on)
      .map(({ it, p }) => ({
        product_name: it.product_name,
        size: it.size,
        qty: it.qty,
        // Exchange: the size wanted. Refund for a wrong size: the size they
        // needed, so we can check it's really out of stock.
        exchange_size: needsSize ? (p.exchange_size || '').trim() : '',
      }))

    if (!items.length) return setError('Pick at least one item.')
    if (kind === 'exchange' && items.some((it) => !it.exchange_size)) {
      return setError('Write the size you want for every piece you are exchanging.')
    }
    if (!reason) return setError('Choose a reason.')
    if (kind === 'refund' && reason === REFUND_WRONG_SIZE && items.some((it) => !it.exchange_size)) {
      return setError('Write the size you needed for every piece.')
    }
    if (reason === 'Other' && !details.trim()) return setError('Tell us a little about what happened.')
    if (kind === 'exchange' && !exchangeIsFree(reason) && !feeOk) {
      return setError('Tick the box to confirm you will pay the exchange delivery charge.')
    }

    setBusy(true)
    setError('')
    const { id, error } = await sendRequest({
      orderId: order.id,
      contact: contact.trim(),
      kind,
      reason,
      items,
      details: details.trim(),
    })
    setBusy(false)
    if (error) return setError(error)
    setSent({ id, kind, fee: kind === 'exchange' && !exchangeIsFree(reason) })
  }

  const open = order?.open_request
  const canRequest = order && order.status === 'delivered' && !open

  return (
    <div className="rp">
      <div className="rp-card">
        <div className="rp-photo">
          {portal.image ? (
            <img src={imgUrl(portal.image, { w: 900, q: 80 })} alt="" loading="lazy" />
          ) : (
            <div className="rp-photo-blank display">PAUSE</div>
          )}
        </div>

        <div className="rp-body">
          <h1 className="display">{portal.heading}</h1>

          {!sent && (
            <form className="rp-find" onSubmit={handleCheck}>
              <label className="rp-field">
                <span className="mono">ORDER NUMBER</span>
                <input
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value.toUpperCase())}
                  placeholder="PC1234567890"
                  autoComplete="off"
                />
              </label>
              <label className="rp-field">
                <span className="mono">EMAIL OR PHONE NUMBER</span>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="017XXXXXXXX or you@email.com"
                  autoComplete="email"
                />
              </label>
              <button type="submit" className="rp-btn mono" disabled={busy}>
                {busy && !order ? 'Checking…' : 'Check order'}
              </button>
              {portal.intro && <p className="rp-intro">{portal.intro}</p>}
            </form>
          )}

          {error && <div className="rp-error mono">{error}</div>}

          {order && !sent && (
            <div className="rp-order">
              <div className="rp-order-head">
                <div>
                  <div className="rp-id mono">{order.id}</div>
                  <div className="rp-hi">Hi {order.first_name || 'there'} —</div>
                </div>
                <span className={`rp-status mono ${order.status}`}>{order.status}</span>
              </div>

              {open && (
                <div className="rp-note mono">
                  You already have an open {open.kind} request for this order
                  (#{open.id}, {open.status}). We'll call or message you — no need to send another.
                </div>
              )}
              {!open && STATUS_NOTE[order.status] && (
                <div className="rp-note mono">
                  {STATUS_NOTE[order.status]} <Link to="/support/contact">Contact us →</Link>
                </div>
              )}

              {canRequest && (
                <form className="rp-form" onSubmit={handleSend}>
                  <div className="rp-kind mono" role="radiogroup" aria-label="Request type">
                    {[
                      ['exchange', 'Exchange'],
                      ['refund', 'Return & refund'],
                    ].map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        className={kind === k ? 'on' : ''}
                        onClick={() => { setKind(k); setReason(''); setError('') }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="rp-label mono">WHICH PIECES?</div>
                  <div className="rp-items">
                    {order.items.map((it, i) => {
                      const p = picked[i] || {}
                      return (
                        <div className={`rp-item ${p.on ? 'on' : ''}`} key={i}>
                          <label className="rp-item-pick">
                            <input
                              type="checkbox"
                              checked={!!p.on}
                              onChange={(e) => toggle(i, { on: e.target.checked })}
                            />
                            <span>
                              {it.product_name}
                              <span className="mono dim"> · {it.size} × {it.qty}</span>
                            </span>
                            <span className="mono rp-price">{taka(it.price * it.qty)}</span>
                          </label>
                          {p.on && needsSize && (
                            <label className="rp-swap mono">
                              {kind === 'exchange' ? 'SIZE YOU WANT' : 'SIZE YOU NEEDED'}
                              <input
                                value={p.exchange_size || ''}
                                onChange={(e) => toggle(i, { exchange_size: e.target.value.toUpperCase() })}
                                placeholder="e.g. L"
                                maxLength={20}
                              />
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <label className="rp-field">
                    <span className="mono">REASON</span>
                    <select value={reason} onChange={(e) => { setReason(e.target.value); setFeeOk(false); setError('') }}>
                      <option value="">Choose a reason</option>
                      {REASONS[kind].map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>

                  {kind === 'refund' && (
                    <div className="rp-fee free mono">
                      <b>HOW A REFUND WORKS</b>
                      <span>
                        We call you first. A refund is only for a faulty or damaged piece, or a wrong size we sent
                        when your size is out of stock — if it's in stock we exchange it instead. We collect the piece
                        at our cost; the first delivery charge isn't refunded.
                      </span>
                    </div>
                  )}
                  {kind === 'exchange' && (
                    reason && exchangeIsFree(reason) ? (
                      <div className="rp-fee free mono">
                        <b>NO DELIVERY CHARGE</b>
                        <span>Our mistake, so we pay the delivery for the exchange. Keep the tags on — we may ask for a photo on WhatsApp.</span>
                      </div>
                    ) : (
                      <div className="rp-fee mono">
                        <b>EXCHANGE DELIVERY CHARGE</b>
                        <span>
                          The new size comes in a second parcel: <b>৳{EXCHANGE_FEE.inside}</b> inside Dhaka,
                          {' '}<b>৳{EXCHANGE_FEE.outside}</b> outside Dhaka — paid to the rider when it arrives.
                          Free if we sent the wrong size, the wrong item or a faulty piece.
                        </span>
                        {reason && (
                          <label className="rp-fee-ok">
                            <input type="checkbox" checked={feeOk} onChange={(e) => { setFeeOk(e.target.checked); setError('') }} />
                            <span>I understand and will pay the delivery charge.</span>
                          </label>
                        )}
                      </div>
                    )
                  )}
                  <label className="rp-field">
                    <span className="mono">DETAILS (OPTIONAL)</span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={details}
                      onChange={(e) => setDetails(e.target.value)}
                      placeholder="Anything that helps — what's wrong, a good time to call…"
                    />
                  </label>

                  <button type="submit" className="rp-btn mono" disabled={busy}>
                    {busy ? 'Sending…' : `Send ${kind} request`}
                  </button>
                  <p className="rp-fine">
                    We reply within one working day. For a fault or a wrong item, keep the tags on —
                    we may ask for a photo on WhatsApp.
                  </p>
                </form>
              )}
            </div>
          )}

          {sent && (
            <div className="rp-sent">
              <div className="rp-id mono">REQUEST #{sent.id}</div>
              <h2 className="display">Request received</h2>
              <p>
                Your {sent.kind} request for {order.id} is with us. We'll call or message you within one
                working day to arrange the {sent.kind === 'exchange' ? 'swap' : 'pickup'}.
                {sent.kind === 'refund' && ' If the size you needed is in stock, we will offer an exchange instead.'}
                {sent.fee && ` Keep the delivery charge ready for the rider: ৳${EXCHANGE_FEE.inside} inside Dhaka, ৳${EXCHANGE_FEE.outside} outside.`}
              </p>
              <Link to="/shop" className="rp-btn mono">Back to shop</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
