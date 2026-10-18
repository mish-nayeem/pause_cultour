import { useEffect, useMemo, useState } from 'react'
import { imgUrl } from '../lib/images.js'
import { createReturn, processReturn } from '../lib/admin.js'
import { isNewRequest, markRequestsSeen, updateRequest } from '../lib/support.js'
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
              {it.exchange_size && <span className="mono rm-want"> → wants {it.exchange_size}</span>}
            </li>
          ))}
        </ul>
      )}
      {r.details && <p className="rm-details">“{r.details}”</p>}

      {open ? (
        <Complete r={r} order={order} productsById={productsById} onReload={onReload} />
      ) : (
        <Resolution r={r} />
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
      init[it.id] = { on: !!a || lines.length === 1, qty: Math.min(Number(a?.qty || it.qty), Number(it.qty)), to: a?.exchange_size || '' }
    }
    return init
  })
  const [refund, setRefund] = useState('')
  const [note, setNote] = useState(r.admin_note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function set(id, patch) {
    setPick((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setError('')
  }

  const chosen = lines.filter((it) => pick[it.id]?.on)
  const suggested = chosen.reduce((sum, it) => sum + Number(it.price) * Number(pick[it.id].qty || 0), 0)

  async function run(action) {
    setError('')
    let items = []
    if (action !== 'reject') {
      if (!chosen.length) return setError('Tick at least one piece.')
      items = chosen.map((it) => ({
        item_id: it.id,
        qty: Number(pick[it.id].qty) || 1,
        ...(action === 'exchange' ? { to_size: pick[it.id].to } : {}),
      }))
      if (action === 'exchange' && items.some((x) => !x.to_size)) return setError('Pick the new size for every ticked piece.')
    }
    const amount = action === 'refund' ? (refund === '' ? suggested : Number(refund) || 0) : 0
    const ask =
      action === 'reject'
        ? 'Reject this request? Nothing in stock or sales changes.'
        : action === 'exchange'
          ? 'Complete the exchange? The old sizes go back into stock and the new sizes come out.'
          : `Complete the refund of ${taka(amount)}? The pieces go back into stock and the money comes off sales.`
    if (!window.confirm(ask)) return

    setBusy(true)
    const { error } = await processReturn({ id: r.id, action, items, refund: amount, note: note.trim() })
    setBusy(false)
    if (error) {
      const msg = error.message || ''
      return setError(msg.includes('admin_process_return') || msg.includes('function') ? `Couldn't complete — ${MIGRATION}` : msg)
    }
    onReload()
  }

  async function accept() {
    setBusy(true)
    const { error } = await updateRequest(r.id, 'approved', note.trim())
    setBusy(false)
    if (error) return setError("Couldn't save. Try again.")
    onReload()
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
            const stock = product ? stockMap(product) : null
            const sizes = (product?.sizes || []).filter((z) => z !== it.size)
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

      {mode === 'refund' && (
        <label className="rm-amount mono">
          Refund amount (৳)
          <input
            inputMode="numeric"
            value={refund === '' ? String(suggested) : refund}
            onChange={(e) => setRefund(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <span className="dim">Ticked pieces come to {taka(suggested)} — add the delivery charge if you're refunding that too.</span>
        </label>
      )}

      <input className="rm-note" placeholder="Note (optional) — e.g. rider picked it up Thursday" value={note} onChange={(e) => setNote(e.target.value)} />

      {error && <div className="rm-error mono">{error}</div>}

      <div className="rm-actions">
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
function Resolution({ r }) {
  const res = r.resolution
  return (
    <div className={`rm-done ${res?.action || r.status}`}>
      {!res && <div className="mono">{r.status === 'rejected' ? 'Rejected' : 'Closed'} {r.resolved_at ? `· ${when(r.resolved_at)}` : ''} (before stock updates were added)</div>}
      {res?.action === 'reject' && <div className="mono">Rejected · {when(res.at)}</div>}
      {res?.action === 'exchange' && (
        <>
          <div className="mono rm-done-head">Exchanged · {when(res.at)}</div>
          {(res.items || []).map((x, i) => (
            <div key={i} className="rm-done-line">
              {x.product_name}: <b className="mono">{x.from_size} → {x.to_size}</b> × {x.qty}
              <span className="mono dim">
                {' '}· stock now {x.from_size} {x.from_left ?? '—'}, {x.to_size} {x.to_left ?? '—'}
              </span>
            </div>
          ))}
        </>
      )}
      {res?.action === 'refund' && (
        <>
          <div className="mono rm-done-head">Refunded {taka(res.refund)} · {when(res.at)}</div>
          {(res.items || []).map((x, i) => (
            <div key={i} className="rm-done-line">
              {x.product_name} · <span className="mono">{x.size} × {x.qty}</span> back in stock
              <span className="mono dim">{x.left != null ? ` · ${x.size} now ${x.left}` : ''}</span>
            </div>
          ))}
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
          <button key={k} type="button" className={`${kind === k ? 'on' : ''} m-${k}`} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      <label className="pf-field">
        <span className="mono">REASON</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong size, faulty, wrong item…" />
      </label>
      {error && <div className="rm-error mono">{error}</div>}
      <button type="submit" className="courier-btn mono" disabled={busy}>{busy ? 'Saving…' : 'Add request'}</button>
    </form>
  )
}
