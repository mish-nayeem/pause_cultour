import { useEffect, useMemo, useRef, useState } from 'react'
import InfoTip from './InfoTip.jsx'
import { imgUrl } from '../lib/images.js'
import './command-search.css'

function taka(n) {
  return '৳ ' + Math.round(Number(n || 0)).toLocaleString()
}

const MAX_EACH = 6

// Spaces and dashes out, so "017 1234-5678" finds 01712345678.
function digits(s) {
  return String(s || '').replace(/[^0-9]/g, '')
}

// One box that finds anything in the panel: an order by its id, a customer
// by name or phone, a product by name, colour or category. Opened with the
// search button in the header, Ctrl+K (⌘K on a Mac) or "/" anywhere outside
// a text box. ↑ ↓ to move, Enter to open, Esc to close.
export default function CommandSearch({ open, onClose, orders, products, onOpenOrder, onOpenProduct, onOpenCustomer }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef(null)
  const list = useRef(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setAt(0)
    // After the box has painted, or the focus is lost on a phone.
    requestAnimationFrame(() => input.current?.focus())
  }, [open])

  const results = useMemo(() => {
    const text = q.trim().toLowerCase()
    if (!text) return []
    const num = digits(text)

    const ord = orders
      .filter((o) =>
        o.id.toLowerCase().includes(text) ||
        (o.customer_name || '').toLowerCase().includes(text) ||
        (num.length >= 3 && digits(o.customer_phone).includes(num))
      )
      .slice(0, MAX_EACH)
      .map((o) => ({ kind: 'order', key: 'o' + o.id, o }))

    // A customer is everyone who ordered from one phone number, however
    // many orders that is.
    const people = new Map()
    for (const o of orders) {
      const phone = digits(o.customer_phone)
      if (!phone) continue
      const hit = (o.customer_name || '').toLowerCase().includes(text) || (num.length >= 3 && phone.includes(num))
      if (!hit) continue
      const c = people.get(phone) || { phone: o.customer_phone, name: o.customer_name, count: 0, spent: 0, area: o.customer_area }
      c.count++
      if (o.status !== 'cancelled' && o.status !== 'returned') c.spent += Number(o.total ?? o.subtotal ?? 0)
      people.set(phone, c)
    }
    const cust = [...people.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_EACH)
      .map((c) => ({ kind: 'customer', key: 'c' + c.phone, c }))

    const prod = products
      .filter((p) =>
        [p.name, p.variant, p.category, p.drop, p.id].some((v) => String(v || '').toLowerCase().includes(text))
      )
      .slice(0, MAX_EACH)
      .map((p) => ({ kind: 'product', key: 'p' + p.id, p }))

    return [...ord, ...cust, ...prod]
  }, [q, orders, products])

  useEffect(() => { setAt(0) }, [q])

  // Keep the highlighted row in view while arrowing down a long list.
  useEffect(() => {
    list.current?.querySelector('.cs-row.on')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  if (!open) return null

  function choose(r) {
    onClose()
    if (r.kind === 'order') onOpenOrder(r.o.id)
    else if (r.kind === 'customer') onOpenCustomer(r.c.phone)
    else onOpenProduct(r.p)
  }

  function key(e) {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(n + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)) }
    else if (e.key === 'Enter' && results[at]) choose(results[at])
  }

  const groups = [
    ['order', 'ORDERS'],
    ['customer', 'CUSTOMERS'],
    ['product', 'PRODUCTS'],
  ]

  return (
    <div className="cs-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cs-box" role="dialog" aria-label="Search the admin">
        <div className="cs-top">
          <input
            ref={input}
            className="cs-input"
            placeholder="Order ID, name, phone or product…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={key}
          />
          <InfoTip>
            <p>Finds anything in the panel in one go.</p>
            <p><b>Orders</b> by order ID, name or phone · <b>Customers</b> by name or phone (every order from one number) · <b>Products</b> by name, colour, category or drop.</p>
            <p>Open it with Ctrl+K (⌘K on a Mac) or the / key. ↑ ↓ to move, Enter to open, Esc to close.</p>
          </InfoTip>
          <button type="button" className="cs-close mono" onClick={onClose}>ESC</button>
        </div>

        <div className="cs-list" ref={list}>
          {!q.trim() && <div className="cs-hint mono">Type to search orders, customers and products.</div>}
          {q.trim() && results.length === 0 && <div className="cs-hint mono">Nothing matches “{q.trim()}”.</div>}

          {groups.map(([kind, label]) => {
            const rows = results.filter((r) => r.kind === kind)
            if (!rows.length) return null
            return (
              <div key={kind} className="cs-group">
                <div className="cs-label mono">{label}</div>
                {rows.map((r) => {
                  const i = results.indexOf(r)
                  return (
                    <button
                      type="button"
                      key={r.key}
                      className={`cs-row ${i === at ? 'on' : ''}`}
                      onPointerEnter={() => setAt(i)}
                      onClick={() => choose(r)}
                    >
                      {kind === 'order' && (
                        <>
                          <span className="cs-main">
                            <b>{r.o.customer_name}</b>
                            <span className="mono">{r.o.id} · {r.o.customer_phone}</span>
                          </span>
                          <span className="cs-side mono">
                            <b>{taka(r.o.total ?? r.o.subtotal)}</b>
                            <span className={`cs-status ${r.o.status}`}>{r.o.status}</span>
                          </span>
                        </>
                      )}
                      {kind === 'customer' && (
                        <>
                          <span className="cs-main">
                            <b>{r.c.name}</b>
                            <span className="mono">{r.c.phone}{r.c.area ? ` · ${r.c.area}` : ''}</span>
                          </span>
                          <span className="cs-side mono">
                            <b>{r.c.count} order{r.c.count === 1 ? '' : 's'}</b>
                            <span>{taka(r.c.spent)}</span>
                          </span>
                        </>
                      )}
                      {kind === 'product' && (
                        <>
                          <span className="cs-thumb">
                            {r.p.images?.[0] && <img src={imgUrl(r.p.images[0], { w: 80 })} alt="" />}
                          </span>
                          <span className="cs-main">
                            <b>{r.p.name}{r.p.variant ? ` — ${r.p.variant}` : ''}</b>
                            <span className="mono">{r.p.category}{r.p.drop ? ` · ${r.p.drop}` : ''}</span>
                          </span>
                          <span className="cs-side mono">
                            <b>{taka(r.p.price)}</b>
                            <span>edit</span>
                          </span>
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
