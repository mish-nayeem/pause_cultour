import { useEffect, useMemo, useState } from 'react'
import InfoTip from './InfoTip.jsx'
import { imgUrl } from '../lib/images.js'
import { createReturn, processReturn } from '../lib/admin.js'
import { EXCHANGE_FEE, EXCHANGE_REASONS, REFUND_WRONG_SIZE, emailCustomer, exchangeDiff, exchangeIsFree, isNewRequest, markExchangeRefund, markRequestsSeen, updateRequest } from '../lib/support.js'
import { stockMap } from '../lib/stock.js'
import './returns-manager.css'

const MIGRATION = 'has supabase-migration-returns-processing.sql been run?'

function taka(n) {
  return '৳ ' + Math.round(Number(n || 0)).toLocaleString()
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })} · ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
}

// The email to the customer once an exchange is accepted (or done), written
// out ready to send — the admin can change any of it first. `lines`: what
// goes back and what comes instead; `diff`: + they owe it, − we owe it.
function exchangeEmail({ order, lines, diff, fee, feePaid, refundTo, done = false }) {
  const first = String(order?.customer_name || '').trim().split(/\s+/)[0] || 'there'
  const swap = lines.map((l) => `• ${l.from} ×${l.qty} → ${l.to}`).join('\n')
  const owesFee = fee > 0 && feePaid
  const parts = [
    `Hi ${first},`,
    done
      ? `Your exchange for order ${order?.id} is done — here's what changed.`
      : `Good news — we've accepted your exchange request for order ${order?.id}.`,
    `The exchange:\n${swap}`,
  ]
  if (diff > 0) {
    parts.push(`The new piece costs ${taka(diff)} more. Please pay the rider ${taka(diff + (owesFee ? fee : 0))} when it arrives (price difference ${taka(diff)}${owesFee ? ` + delivery ${taka(fee)}` : ''}).`)
  } else if (diff < 0) {
    parts.push(refundTo
      ? `The new piece costs ${taka(-diff)} less, so we'll send ${taka(-diff)} to your bKash ${refundTo} (Send Money) once we have your piece back.`
      : `The new piece costs ${taka(-diff)} less, so we'll send ${taka(-diff)} back to you by bKash. Please reply with the bKash number we should send it to.`)
    if (owesFee) parts.push(`The delivery charge for the exchange, ${taka(fee)}, is paid to the rider.`)
  } else if (owesFee) {
    parts.push(`The delivery charge for the exchange, ${taka(fee)}, is paid to the rider when the new piece arrives.`)
  } else {
    parts.push(`There's nothing to pay — the exchange delivery is on us.`)
  }
  if (!done) parts.push('Our rider will bring the new piece and take the old one — please keep it ready with its tags on.')
  parts.push('Thanks,\nPAUSE')
  return { subject: `${done ? 'Your exchange is done' : 'Your exchange is accepted'} · order ${order?.id}`, text: parts.join('\n\n') }
}

// The email once a refund has gone out by bKash — the money, where it went.
function refundSentEmail({ order, amount, refundTo, trx }) {
  const first = String(order?.customer_name || '').trim().split(/\s+/)[0] || 'there'
  return {
    subject: `Your refund has been sent · order ${order?.id}`,
    text: [
      `Hi ${first},`,
      `Your refund for order ${order?.id} has been sent successfully.`,
      `Amount: ${taka(amount)}\nSent to bKash: ${refundTo || '—'}${trx ? `\nTrxID: ${trx}` : ''}`,
      `It should already show in your bKash account. If it doesn't, reply to this email with your order number.`,
      'Thanks,\nPAUSE',
    ].join('\n\n'),
  }
}

// The email, open to edit, then sent to the order's customer.
function EmailComposer({ orderId, email, start, onClose }) {
  const [subject, setSubject] = useState(start.subject)
  const [text, setText] = useState(start.text)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  async function send() {
    setBusy(true)
    setNote('')
    const { error, to } = await emailCustomer(orderId, subject, text)
    setBusy(false)
    if (error) return setNote(`Couldn't send — ${error}`)
    setNote(`Sent to ${to}.`)
    setTimeout(onClose, 1200)
  }
  return (
    <div className="rm-mail">
      <div className="rm-mail-head mono">
        EMAIL TO THE CUSTOMER {email ? `· ${email}` : '· no email on this order'}
        <InfoTip>Written out from the exchange — change anything, then Send. It goes from the shop's email address in the PAUSE letter style.</InfoTip>
      </div>
      <input className="rm-note" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
      <textarea className="rm-note rm-mail-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} aria-label="Email" />
      {note && <div className="mono rm-mail-note">{note}</div>}
      <div className="rm-actions">
        <button type="button" className="courier-btn ghost mono" onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className="courier-btn mono" onClick={send} disabled={busy || !email || !subject.trim() || !text.trim()}>{busy ? 'Sending…' : 'Send email'}</button>
      </div>
    </div>
  )
}

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
]

const STATUS = {
  open: { label: 'Open', cls: 'open' },
  approved: { label: 'Accepted', cls: 'accepted' },
  resolved: { label: 'Done', cls: 'done' },
  rejected: { label: 'Rejected', cls: 'rejected' },
}

// ---------------------------------------------------------------------------
// Admin → Support → Returns & exchanges
// ---------------------------------------------------------------------------
// The one place for every refund, return and exchange — sent by customers
// from the Support page's portal, or logged here by hand for one raised over
// a DM or a call. Completing one moves the stock and the sales figures:
//
//   Exchange — the old size goes back into stock, the new size comes out.
//              Stock and the sale's value stay the same.
//   Refund   — the pieces go back into stock, stop counting as sold, and the
//              refunded taka comes off revenue.
//
// What was done stays on the request, with the order's details, for good.
export default function ReturnsManager({ requests, orders, products, onSeen, onReload }) {
  const [freshIds] = useState(() => new Set(requests.filter(isNewRequest).map((r) => r.id)))
  const [filter, setFilter] = useState('open')
  const [logging, setLogging] = useState(false)

  // Opening the list counts as having seen what's new on it.
  useEffect(() => {
    const ids = [...freshIds]
    if (!ids.length) return
    markRequestsSeen(ids).then(({ error }) => {
      if (!error) onSeen(ids)
    })
    // Once, for the ones that were new when the list opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products])

  const shown = useMemo(() => {
    if (filter === 'all') return requests
    if (filter === 'done') return requests.filter((r) => r.status === 'resolved' || r.status === 'rejected')
    return requests.filter((r) => r.status === 'open' || r.status === 'approved')
  }, [requests, filter])

  const openCount = requests.filter((r) => r.status === 'open' || r.status === 'approved').length

  return (
    <section className="panel rm-panel">
      <div className="rm-head">
        <div>
          <div className="panel-label mono">RETURNS, REFUNDS &amp; EXCHANGES</div>
          <p className="rm-help">
            Every request in one place — from the Support page's portal, or logged here for one that
            came by DM or call. Completing one updates the stock and the sales figures by itself.
          </p>
        </div>
        <button type="button" className="courier-btn mono" onClick={() => setLogging((v) => !v)}>
          {logging ? 'Close' : '+ Log a request'}
        </button>
      </div>

      {logging && (
        <LogForm
          orders={orders}
          onDone={() => {
            setLogging(false)
            onReload()
          }}
        />
      )}

      <div className="rm-filter mono">
        {FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
            {f.label}
            {f.key === 'open' && openCount > 0 && <span className="rm-n">{openCount}</span>}
          </button>
        ))}
      </div>

      {shown.length === 0 && <div className="empty mono">Nothing here.</div>}

      <div className="rm-list">
        {shown.map((r) => (
          <RequestCard
            key={r.id}
            r={r}
            fresh={freshIds.has(r.id)}
            order={ordersById.get(r.order_id)}
            productsById={productsById}
            onReload={onReload}
          />
        ))}
      </div>
    </section>
  )
}

// One request: who, which order, what they asked for — then, while it's
// open, the exchange / refund / reject to complete it; once done, what was
// done.
function RequestCard({ r, fresh, order, productsById, onReload }) {
  const open = r.status === 'open' || r.status === 'approved'
  const st = STATUS[r.status] || STATUS.open
  const [showOrder, setShowOrder] = useState(false)

  return (
    <article className={`rm-card ${fresh ? 'fresh' : ''} ${open ? '' : 'closed'}`}>
      <div className="rm-top">
        <div className="rm-who">
          <div className="rm-meta mono">
            #{r.id} · {when(r.created_at)}
            {fresh && <span className="rm-new">NEW</span>}
          </div>
          <div className="rm-title">
            <span className={`rm-kind ${r.kind}`}>{r.kind === 'refund' ? 'Refund' : r.kind === 'exchange' ? 'Exchange' : 'Return'}</span>
            <span>{r.reason}</span>
          </div>
          <div className="rm-sub mono">
            <button type="button" className="rm-order-link" onClick={() => setShowOrder((v) => !v)}>
              {r.order_id} {showOrder ? '▴' : '▾'}
            </button>
            {' · '}{r.orders?.customer_name || order?.customer_name || '—'}
            {(r.orders?.customer_phone || order?.customer_phone) && (
              <> · <a href={`tel:${r.orders?.customer_phone || order?.customer_phone}`}>{r.orders?.customer_phone || order?.customer_phone}</a></>
            )}
            {' · '}{r.source === 'customer' ? 'from the portal' : 'logged by admin'}
          </div>
        </div>
        <span className={`rm-status mono ${st.cls}`}>{st.label}</span>
      </div>

      {showOrder && <OrderSummary order={order} />}

      {Array.isArray(r.items) && r.items.length > 0 && (
        <ul className="rm-asked">
          {r.items.map((it, i) => (
            <li key={i}>
              Asked: {it.product_name} · <span className="mono">{it.size} × {it.qty}</span>
              {(it.exchange_size || it.exchange_product_name) && (
                <span className="mono rm-want"> → wants {it.exchange_product_name ? `${it.exchange_product_name} ` : ''}{it.exchange_size}</span>
              )}
              {it.exchange_price != null && Number(it.exchange_price) !== Number(it.price) && (
                <span className="mono rm-want">
                  {' '}({Number(it.exchange_price) > Number(it.price) ? '+' : '−'} {taka(Math.abs(Number(it.exchange_price) - Number(it.price)) * (Number(it.qty) || 1))})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {r.details && <p className="rm-details">“{r.details}”</p>}
      {r.refund_to && <p className="rm-details mono">Refund the difference to bKash: <b>{r.refund_to}</b></p>}

      {open ? (
        <Complete r={r} order={order} productsById={productsById} onReload={onReload} />
      ) : (
        <Resolution r={r} order={order} onReload={onReload} />
      )}
    </article>
  )
}

function OrderSummary({ order }) {
  if (!order) return <div className="rm-order mono">Order not found — it may have been deleted.</div>
  return (
    <div className="rm-order">
      <div className="rm-order-row mono">
        <span>Placed {when(order.created_at)}</span>
        <span className="rm-order-status">{order.status}</span>
      </div>
      {(order.order_items || []).map((it) => {
        const ordered = it.ordered_qty ?? it.qty
        return (
          <div className="rm-order-row" key={it.id}>
            <span>
              {it.product_name} · <span className="mono">{it.size} × {ordered}</span>
              {ordered !== it.qty && <span className="mono rm-back"> · {ordered - it.qty} returned</span>}
            </span>
            <span className="mono">{taka(it.price * ordered)}</span>
          </div>
        )
      })}
      <div className="rm-order-row mono rm-order-total">
        <span>Paid</span>
        <span>{taka(order.paid_total ?? order.total ?? order.subtotal)}</span>
      </div>
      {order.refunded > 0 && (
        <div className="rm-order-row mono rm-back">
          <span>Refunded</span>
          <span>− {taka(order.refunded)}</span>
        </div>
      )}
      {order.customer_address && <div className="rm-order-row rm-addr">{order.customer_address}{order.customer_area ? `, ${order.customer_area}` : ''}</div>}
    </div>
  )
}

// Matches what the customer asked for to the order's own lines, so the
// form starts ticked the way they asked.
function askedFor(r, it) {
  return (r.items || []).find((x) => x.product_name === it.product_name && x.size === it.size)
}

function Complete({ r, order, productsById, onReload }) {
  const [mode, setMode] = useState(r.kind === 'refund' ? 'refund' : 'exchange')
  const lines = useMemo(() => (order?.order_items || []).filter((it) => Number(it.qty) > 0), [order])
  const [pick, setPick] = useState(() => {
    const init = {}
    for (const it of lines) {
      const a = askedFor(r, it)
      init[it.id] = { on: !!a || lines.length === 1, qty: Math.min(Number(a?.qty || it.qty), Number(it.qty)), to: a?.exchange_size || '', prod: a?.exchange_product_id || '' }
    }
    return init
  })
  const [refund, setRefund] = useState('')
  // The exchange parcel's delivery charge: the same zone's rate — 80 in
  // Dhaka, 150 outside — unless typed otherwise.
  const [fee, setFee] = useState(() => String(order?.delivery_zone === 'inside' || order?.customer_area === 'Dhaka' ? EXCHANGE_FEE.inside : EXCHANGE_FEE.outside))
  // Only "Wrong size ordered" is the customer's to pay; every other reason
  // is our mistake, so we carry it — the reason they gave picks the default.
  const [feePaid, setFeePaid] = useState(() => !exchangeIsFree(r.reason))
  const [note, setNote] = useState(r.admin_note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function set(id, patch) {
    setPick((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setError('')
  }

  const chosen = lines.filter((it) => pick[it.id]?.on)

  // A wrong-size refund is only for a size we can't send: if the size the
  // customer needed is in stock, the policy is to exchange instead.
  const inStockInstead = r.reason === REFUND_WRONG_SIZE
    ? chosen
        .map((it) => {
          const want = askedFor(r, it)?.exchange_size
          const product = productsById.get(String(it.product_id))
          const n = want && product ? stockMap(product)?.[want] : null
          return n > 0 ? `${it.product_name} ${want} (${n} in stock)` : null
        })
        .filter(Boolean)
    : []
  const suggested = chosen.reduce((sum, it) => sum + Number(it.price) * Number(pick[it.id].qty || 0), 0)

  // The exchange's price difference: each ticked piece moving to another
  // product, at that product's price (a running sale is taken off on save).
  const targetOf = (it) => {
    const id = pick[it.id]?.prod
    return id && String(id) !== String(it.product_id) ? productsById.get(String(id)) : null
  }
  const diffTotal = chosen.reduce((sum, it) => {
    const t = targetOf(it)
    return t ? sum + (Number(t.price) - Number(it.price)) * (Number(pick[it.id].qty) || 1) : sum
  }, 0)
  const feeNow = Math.max(0, Number(fee) || 0)
  // The email, ready to edit, from the exchange as it's set up here.
  const [mail, setMail] = useState(null)
  function draftMail() {
    const lines = chosen.map((it) => {
      const t = targetOf(it)
      const to = pick[it.id].to || '?'
      return { from: `${it.product_name} ${it.size}`, to: t ? `${t.name}${t.variant ? ` · ${t.variant}` : ''} ${to}` : `${it.product_name} ${to}`, qty: Number(pick[it.id].qty) || 1 }
    })
    return exchangeEmail({ order, lines, diff: diffTotal, fee: feeNow, feePaid, refundTo: r.refund_to })
  }

  async function run(action) {
    setError('')
    let items = []
    if (action !== 'reject') {
      if (!chosen.length) return setError('Tick at least one piece.')
      items = chosen.map((it) => ({
        item_id: it.id,
        qty: Number(pick[it.id].qty) || 1,
        ...(action === 'exchange' ? { to_size: pick[it.id].to, ...(pick[it.id].prod && String(pick[it.id].prod) !== String(it.product_id) ? { to_product_id: String(pick[it.id].prod) } : {}) } : {}),
      }))
      if (action === 'exchange' && items.some((x) => !x.to_size)) return setError('Pick the new size for every ticked piece.')
    }
    const amount = action === 'refund' ? (refund === '' ? suggested : Number(refund) || 0) : 0
    // Exchange: the new size's parcel. Refund: the pickup parcel — always ours.
    const feeAmount = action === 'exchange' || action === 'refund' ? Math.max(0, Number(fee) || 0) : 0
    const ask =
      action === 'reject'
        ? 'Reject this request? Nothing in stock or sales changes.'
        : action === 'exchange'
          ? `Complete the exchange? The order changes to the new pieces, the old ones go back into stock and the new ones come out.${feeAmount ? ` Delivery ${taka(feeAmount)} — ${feePaid ? 'paid by the customer' : 'paid by us, off revenue'}.` : ''}${diffTotal > 0 ? ` The customer owes ${taka(diffTotal)} more — the rider collects it, and it's added to revenue.` : diffTotal < 0 ? ` We owe the customer ${taka(-diffTotal)} — send it by bKash${r.refund_to ? ` to ${r.refund_to}` : ''}; it comes off revenue.` : ''}`
          : `Complete the refund of ${taka(amount)}? The pieces go back into stock and the money comes off revenue.${feeAmount ? ` Pickup delivery ${taka(feeAmount)} — paid by us, off revenue.` : ''}`
    if (!window.confirm(ask)) return

    setBusy(true)
    const { error } = await processReturn({ id: r.id, action, items, refund: amount, note: note.trim(), fee: feeAmount, feePaid: action === 'refund' ? false : feePaid })
    setBusy(false)
    if (error) {
      const msg = error.message || ''
      return setError(msg.includes('admin_process_return') || msg.includes('function') ? `Couldn't complete — ${MIGRATION}` : msg)
    }
    onReload()
  }

  // Accepted: the email to the customer opens, written out, to edit and send.
  async function accept() {
    setBusy(true)
    const { error } = await updateRequest(r.id, 'approved', note.trim())
    setBusy(false)
    if (error) return setError("Couldn't save. Try again.")
    if (mode === 'exchange' && order?.customer_email) setMail(draftMail())
    else onReload()
  }

  if (!order) {
    return <div className="rm-error mono">The order for this request can't be found, so it can't be completed here.</div>
  }

  return (
    <div className="rm-complete">
      <div className="rm-modes mono" role="tablist">
        {[
          ['exchange', 'Exchange'],
          ['refund', 'Return & refund'],
          ['reject', 'Reject'],
        ].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} className={`${mode === k ? 'on' : ''} m-${k}`} onClick={() => { setMode(k); setError('') }}>
            {label}
          </button>
        ))}
      </div>

      {mode !== 'reject' && (
        <div className="rm-lines">
          {lines.map((it) => {
            const p = pick[it.id] || {}
            const product = productsById.get(String(it.product_id))
            // Exchange to: this product, or another at the same price.
            const swapTo = p.prod && String(p.prod) !== String(it.product_id) ? productsById.get(String(p.prod)) : null
            const target = swapTo || product
            const stock = target ? stockMap(target) : null
            const sizes = (target?.sizes || []).filter((z) => swapTo || z !== it.size)
            // Any other product — same price first, then the nearest.
            const others = [...productsById.values()]
              .filter((x) => String(x.id) !== String(it.product_id))
              .sort((a, b) => Math.abs(Number(a.price) - Number(it.price)) - Math.abs(Number(b.price) - Number(it.price)))
            return (
              <div className={`rm-line ${p.on ? 'on' : ''}`} key={it.id}>
                <label className="rm-line-pick">
                  <input type="checkbox" checked={!!p.on} onChange={(e) => set(it.id, { on: e.target.checked })} />
                  <span className="rm-thumb">
                    {product?.images?.[0] && <img src={imgUrl(product.images[0], { w: 100 })} alt="" />}
                  </span>
                  <span className="rm-line-name">
                    {it.product_name}
                    <span className="mono"> · {it.size}{stock ? ` (${stock[it.size] ?? 0} in stock)` : ''}</span>
                  </span>
                </label>
                {p.on && (
                  <div className="rm-line-opts mono">
                    <label>
                      Qty
                      <select value={p.qty} onChange={(e) => set(it.id, { qty: Number(e.target.value) })}>
                        {Array.from({ length: Number(it.qty) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    {mode === 'exchange' && others.length > 0 && (
                      <label>
                        Product
                        <select value={p.prod || ''} onChange={(e) => set(it.id, { prod: e.target.value, to: '' })}>
                          <option value="">Same product</option>
                          {others.map((x) => {
                            const d = Number(x.price) - Number(it.price)
                            return <option key={x.id} value={x.id}>{x.name}{x.variant ? ` · ${x.variant}` : ''} · {taka(x.price)}{d ? ` (${d > 0 ? '+' : '−'}${taka(Math.abs(d))})` : ''}</option>
                          })}
                        </select>
                      </label>
                    )}
                    {mode === 'exchange' && (
                      <label>
                        New size
                        {sizes.length ? (
                          <select value={p.to} onChange={(e) => set(it.id, { to: e.target.value })}>
                            <option value="">Pick</option>
                            {sizes.map((z) => {
                              const n = stock ? stock[z] ?? 0 : null
                              return (
                                <option key={z} value={z} disabled={n === 0}>
                                  {z}{n == null ? '' : n === 0 ? ' — none left' : ` — ${n} left`}
                                </option>
                              )
                            })}
                          </select>
                        ) : (
                          <input value={p.to} onChange={(e) => set(it.id, { to: e.target.value.toUpperCase() })} placeholder="e.g. L" />
                        )}
                      </label>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {lines.length === 0 && <div className="empty mono">Every piece on this order has already been refunded.</div>}
        </div>
      )}

      {mode === 'exchange' && (
        <div className="rm-fee mono">
          <label className="rm-amount">
            <span className="rm-fee-head">
              Exchange delivery charge (৳)
              <InfoTip>
                <p>The new size goes out in a second parcel, and the courier keeps its delivery charge — {taka(EXCHANGE_FEE.inside)} in Dhaka, {taka(EXCHANGE_FEE.outside)} outside, filled in from the order's district. Change it if the courier charged something else; 0 if there's no parcel.</p>
                <p><b>Customer pays</b> — the rider collects it, the courier keeps it: no change to your revenue.</p>
                <p><b>We pay</b> — our mistake (wrong item, a fault): it comes off your revenue.</p>
              </InfoTip>
            </span>
            <input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <div className="rm-fee-pick" role="radiogroup" aria-label="Who pays the exchange delivery">
            {[[true, 'Customer pays'], [false, 'We pay']].map(([v, label]) => (
              <button key={label} type="button" role="radio" aria-checked={feePaid === v} className={feePaid === v ? 'on' : ''} onClick={() => setFeePaid(v)}>
                {label}
              </button>
            ))}
          </div>
          <span className="dim">The order changes to the new size; the old size goes back into stock, the new one comes out.</span>
        </div>
      )}

      {/* Another product at a different price: who owes what. */}
      {mode === 'exchange' && diffTotal !== 0 && (
        <div className={`rm-diff mono ${diffTotal > 0 ? 'pay' : 'back'}`}>
          <span className="rm-fee-head">
            {diffTotal > 0 ? `Price difference · customer pays + ${taka(diffTotal)}` : `Price difference · we refund ${taka(-diffTotal)}`}
            <InfoTip>
              <p><b>Dearer product</b> — the customer pays the difference to the rider with the new piece (plus the delivery charge when they pay it). It's added to this order's revenue; the courier keeps its 1% of the cash it collects, as on any order.</p>
              <p><b>Cheaper product</b> — we owe the customer the difference. Send it by bKash (Send Money) to the number they gave, then mark it sent once the exchange is done. It comes off this order's revenue.</p>
              <p>Prices are the products' prices now; a running sale is taken off when you complete it.</p>
            </InfoTip>
          </span>
          {diffTotal > 0 ? (
            <span>Rider collects {taka(diffTotal + (feePaid ? feeNow : 0))} = difference {taka(diffTotal)}{feePaid && feeNow ? ` + delivery ${taka(feeNow)}` : ''}.</span>
          ) : (
            <span>Send {taka(-diffTotal)} by bKash to <b>{r.refund_to || 'the number they give you'}</b>{feePaid && feeNow ? `; the rider still collects the delivery ${taka(feeNow)}` : ''}.</span>
          )}
        </div>
      )}

      {mode === 'refund' && inStockInstead.length > 0 && (
        <div className="rm-error mono">
          The size they needed is in stock: {inStockInstead.join(', ')}. Our policy is to exchange a wrong size when the right one is available — switch to Exchange, unless you've agreed otherwise on the call.
        </div>
      )}

      {mode === 'refund' && (
        <div className="rm-fee mono">
          <label className="rm-amount">
            <span className="rm-fee-head">
              Pickup delivery charge (৳) — we pay
              <InfoTip>
                <p>The courier charges for the parcel that brings the piece back — {taka(EXCHANGE_FEE.inside)} in Dhaka, {taka(EXCHANGE_FEE.outside)} outside, filled in from the order's district. We always pay this one, so it comes off revenue.</p>
                <p>The customer's first delivery charge is not refunded — it stays with the courier.</p>
              </InfoTip>
            </span>
            <input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
        </div>
      )}

      {mode === 'refund' && (
        <label className="rm-amount mono">
          Refund amount (৳)
          <input
            inputMode="numeric"
            value={refund === '' ? String(suggested) : refund}
            onChange={(e) => setRefund(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <span className="dim">Ticked pieces come to {taka(suggested)}. The first delivery charge isn't refunded. Goes to bKash <b>{r.refund_to || '— ask the customer for a number'}</b>; mark it sent once you've sent it.</span>
        </label>
      )}

      <input className="rm-note" placeholder="Note (optional) — e.g. rider picked it up Thursday" value={note} onChange={(e) => setNote(e.target.value)} />

      {error && <div className="rm-error mono">{error}</div>}

      {mail && (
        <EmailComposer orderId={order.id} email={order.customer_email} start={mail} onClose={() => { setMail(null); onReload() }} />
      )}

      <div className="rm-actions">
        {mode === 'exchange' && !mail && order?.customer_email && (
          <button type="button" className="courier-btn ghost mono" disabled={busy} onClick={() => setMail(draftMail())} title="Write the customer an email about this exchange">
            ✉ Email the customer
          </button>
        )}
        {r.status === 'open' && mode !== 'reject' && (
          <button type="button" className="courier-btn ghost mono" disabled={busy} onClick={accept} title="Told the customer yes — waiting for the piece to come back">
            Accept, waiting for the piece
          </button>
        )}
        {mode === 'exchange' && (
          <button type="button" className="courier-btn mono" disabled={busy} onClick={() => run('exchange')}>
            {busy ? 'Saving…' : 'Complete exchange'}
          </button>
        )}
        {mode === 'refund' && (
          <button type="button" className="courier-btn mono" disabled={busy} onClick={() => run('refund')}>
            {busy ? 'Saving…' : 'Complete refund'}
          </button>
        )}
        {mode === 'reject' && (
          <button type="button" className="courier-btn mono rm-reject" disabled={busy} onClick={() => run('reject')}>
            {busy ? 'Saving…' : 'Reject request'}
          </button>
        )}
      </div>
    </div>
  )
}

// What was done, once a request is closed — kept for good.
function Resolution({ r, order, onReload }) {
  const res = r.resolution
  const [trx, setTrx] = useState('')
  const [busy, setBusy] = useState(false)
  const [mail, setMail] = useState(null)
  const [note, setNote] = useState('')
  // Money owed back by bKash: a refund, or a cheaper exchange's difference.
  const refundDue = res?.action === 'refund' ? Number(res.refund) || 0 : Number(res?.refund_due) || 0
  const extraDue = Number(res?.extra_due) || 0
  const refundTo = res?.refund_to || r.refund_to

  // Sent: marked here, then the "refund sent" email opens, ready to send.
  async function markSent() {
    setBusy(true)
    const { error } = await markExchangeRefund(r.id, trx.trim())
    setBusy(false)
    if (error) return setNote("Couldn't save — has the exchange SQL run?")
    if (order?.customer_email) setMail({ ...refundSentEmail({ order, amount: refundDue, refundTo, trx: trx.trim() }), after: true })
    else onReload()
  }

  const refundBox = refundDue > 0 && (
    <div className={`rm-refund mono ${res.refund_sent_at ? 'sent' : ''}`}>
      {res.refund_sent_at ? (
        <>✓ Refund {taka(refundDue)} sent to bKash {refundTo || '—'} · {when(res.refund_sent_at)}{res.refund_trx ? ` · TrxID ${res.refund_trx}` : ''}</>
      ) : (
        <>
          <span>
            Refund {taka(refundDue)} by bKash (Send Money) to <b>{refundTo || 'ask the customer for a number'}</b>
            <InfoTip>Send it from the shop's bKash, paste the TrxID from the SMS here and Mark sent — then the "refund sent" email opens, ready to send. It's already taken off this order's revenue.</InfoTip>
          </span>
          <span className="rm-refund-row">
            <input value={trx} onChange={(e) => setTrx(e.target.value.toUpperCase())} placeholder="TrxID (optional)" maxLength={40} />
            <button type="button" className="courier-btn mono" disabled={busy} onClick={markSent}>{busy ? 'Saving…' : 'Mark sent'}</button>
          </span>
        </>
      )}
    </div>
  )

  function draft() {
    const lines = (res.items || []).map((x) => ({
      from: `${x.product_name} ${x.from_size}`,
      to: `${x.to_product_name && String(x.to_product_id) !== String(x.product_id) ? x.to_product_name : x.product_name} ${x.to_size}`,
      qty: x.qty,
    }))
    return exchangeEmail({ order, lines, diff: Number(res.price_diff) || exchangeDiff(res.items), fee: Number(res.fee) || 0, feePaid: res.fee_paid !== false, refundTo, done: true })
  }

  return (
    <div className={`rm-done ${res?.action || r.status}`}>
      {!res && <div className="mono">{r.status === 'rejected' ? 'Rejected' : 'Closed'} {r.resolved_at ? `· ${when(r.resolved_at)}` : ''} (before stock updates were added)</div>}
      {res?.action === 'reject' && <div className="mono">Rejected · {when(res.at)}</div>}
      {res?.action === 'exchange' && (
        <>
          <div className="mono rm-done-head">
            Exchanged · {when(res.at)}
            {Number(res.fee) > 0 && ` · delivery ${taka(res.fee)} ${res.fee_paid === false ? 'paid by us' : 'paid by customer'}`}
          </div>
          {(res.items || []).map((x, i) => (
            <div key={i} className="rm-done-line">
              {x.to_product_name && String(x.to_product_id) !== String(x.product_id)
                ? <>{x.product_name} {x.from_size} → <b className="mono">{x.to_product_name} {x.to_size}</b> × {x.qty}</>
                : <>{x.product_name}: <b className="mono">{x.from_size} → {x.to_size}</b> × {x.qty}</>}
              <span className="mono dim">
                {' '}· stock now {x.from_size} {x.from_left ?? '—'}, {x.to_size} {x.to_left ?? '—'}
              </span>
            </div>
          ))}
          {extraDue > 0 && (
            <div className="rm-done-line mono">Price difference + {taka(extraDue)} · the rider collects it with the new piece · in revenue</div>
          )}
          {refundBox}
          {note && <div className="rm-error mono">{note}</div>}
          {order?.customer_email && !mail && (
            <button type="button" className="courier-btn ghost mono rm-mail-btn" onClick={() => setMail(draft())}>✉ Email the customer</button>
          )}
          {mail && <EmailComposer orderId={order.id} email={order.customer_email} start={mail} onClose={() => { const after = mail.after; setMail(null); if (after) onReload() }} />}
        </>
      )}
      {res?.action === 'refund' && (
        <>
          <div className="mono rm-done-head">
            Refunded {taka(res.refund)} · {when(res.at)}
            {Number(res.fee) > 0 && ` · pickup ${taka(res.fee)} paid by us`}
          </div>
          {(res.items || []).map((x, i) => (
            <div key={i} className="rm-done-line">
              {x.product_name} · <span className="mono">{x.size} × {x.qty}</span> back in stock
              <span className="mono dim">{x.left != null ? ` · ${x.size} now ${x.left}` : ''}</span>
            </div>
          ))}
          {refundBox}
          {note && <div className="rm-error mono">{note}</div>}
          {order?.customer_email && !mail && res.refund_sent_at && (
            <button type="button" className="courier-btn ghost mono rm-mail-btn" onClick={() => setMail(refundSentEmail({ order, amount: refundDue, refundTo, trx: res.refund_trx }))}>✉ Email the customer</button>
          )}
          {mail && <EmailComposer orderId={order.id} email={order.customer_email} start={mail} onClose={() => { const after = mail.after; setMail(null); if (after) onReload() }} />}
        </>
      )}
      {r.admin_note && <div className="rm-done-note">Note: {r.admin_note}</div>}
    </div>
  )
}

// For a refund or exchange that came by DM or call: which order, which kind,
// why. The pieces and sizes are picked when it's completed, same as one from
// the portal.
function LogForm({ orders, onDone }) {
  const [orderId, setOrderId] = useState('')
  const [kind, setKind] = useState('exchange')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    const id = orderId.trim().toUpperCase()
    if (!orders.some((o) => o.id === id)) return setError('Pick an order from the list.')
    if (!reason.trim()) return setError('Write the reason.')
    setBusy(true)
    const { error } = await createReturn({ orderId: id, reason: reason.trim(), kind })
    setBusy(false)
    if (error) return setError(`Couldn't save — has supabase-migration-support.sql been run?`)
    onDone()
  }

  return (
    <form className="rm-log" onSubmit={submit}>
      <label className="pf-field">
        <span className="mono">ORDER</span>
        <input list="rm-orders" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Type the order number or the name" />
        <datalist id="rm-orders">
          {orders.map((o) => (
            <option key={o.id} value={o.id}>{o.customer_name} · {o.customer_phone}</option>
          ))}
        </datalist>
      </label>
      <div className="rm-modes mono">
        {[
          ['exchange', 'Exchange'],
          ['refund', 'Return & refund'],
        ].map(([k, label]) => (
          <button key={k} type="button" className={`${kind === k ? 'on' : ''} m-${k}`} onClick={() => { setKind(k); setReason('') }}>{label}</button>
        ))}
      </div>
      <label className="pf-field">
        <span className="mono">REASON</span>
        {/* An exchange's reason decides who pays its delivery, so it's one
            of the portal's four; a refund's is typed freely. */}
        {kind === 'exchange' ? (
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose a reason</option>
            {EXCHANGE_REASONS.map((x) => (
              <option key={x} value={x}>{x}{exchangeIsFree(x) ? ' — we pay delivery' : ' — customer pays delivery'}</option>
            ))}
          </select>
        ) : (
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Faulty, wrong item, missing piece…" />
        )}
      </label>
      {error && <div className="rm-error mono">{error}</div>}
      <button type="submit" className="courier-btn mono" disabled={busy}>{busy ? 'Saving…' : 'Add request'}</button>
    </form>
  )
}
