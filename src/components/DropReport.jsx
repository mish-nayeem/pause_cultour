import { useMemo, useState } from 'react'
import { imgUrl } from '../lib/images.js'
import { dropKey } from '../lib/lookbook.js'
import { stockMap } from '../lib/stock.js'
import './drop-report.css'

function taka(n) {
  return '৳ ' + Number(n || 0).toLocaleString()
}

// Products → Drop sales. One card per drop: pieces sold, pieces still in
// stock, and how much of the drop has sold. Open a drop to see each
// product, size by size. Cancelled orders don't count; every other order
// does, since its pieces have already left the stock.
export default function DropReport({ products, orders }) {
  const [open, setOpen] = useState(null)

  const drops = useMemo(() => {
    // Sold per product and size, from every order that wasn't cancelled.
    const sold = new Map()
    for (const o of orders) {
      if (o.status === 'cancelled') continue
      for (const it of o.order_items || []) {
        const id = String(it.product_id)
        const row = sold.get(id) || { units: 0, value: 0, sizes: {} }
        const qty = Number(it.qty) || 0
        row.units += qty
        row.value += qty * Number(it.price || 0)
        if (it.size) row.sizes[it.size] = (row.sizes[it.size] || 0) + qty
        sold.set(id, row)
      }
    }

    // Grouped by drop however it's spelt; products without one are left out.
    const groups = new Map()
    for (const p of products) {
      if (!p.drop_name || !p.drop_name.trim()) continue
      const key = dropKey(p.drop_name)
      const g = groups.get(key) || { name: p.drop_name.trim(), items: [], sold: 0, value: 0, left: 0, countedSold: 0, untracked: 0 }
      const s = sold.get(String(p.id)) || { units: 0, value: 0, sizes: {} }
      const stock = stockMap(p)
      const sizes = Array.isArray(p.sizes) ? p.sizes : []
      const left = stock ? sizes.reduce((sum, z) => sum + (stock[z] ?? 0), 0) : null
      g.items.push({
        product: p,
        sold: s.units,
        value: s.value,
        left,
        sizes: sizes.map((z) => ({ size: z, sold: s.sizes[z] || 0, left: stock ? stock[z] ?? 0 : null })),
      })
      g.sold += s.units
      g.value += s.value
      if (left == null) g.untracked += 1
      else {
        g.left += left
        g.countedSold += s.units
      }
      groups.set(key, g)
    }

    return [...groups.values()]
      .map((g) => ({
        ...g,
        items: g.items.sort((a, b) => b.sold - a.sold),
        // Share that's gone, from products with a stock count only — one
        // without a count has no "left" to compare its sales against.
        pct: g.countedSold + g.left > 0 ? Math.round((g.countedSold / (g.countedSold + g.left)) * 100) : 0,
      }))
      .sort((a, b) => b.sold - a.sold)
  }, [products, orders])

  return (
    <section className="panel">
      <div className="panel-label mono" style={{ marginBottom: '6px' }}>DROP SALES</div>
      <div className="panel-note" style={{ marginBottom: '18px' }}>
        Every drop: pieces sold, pieces still in stock and how much of it has sold. Tap a drop
        to see each product, size by size. Cancelled orders don't count.
      </div>

      {drops.length === 0 && (
        <div className="empty mono">No drops yet — give products a collection / drop first.</div>
      )}

      <div className="dr-list">
        {drops.map((d) => {
          const isOpen = open === d.name
          return (
            <div className={`dr-card ${isOpen ? 'open' : ''}`} key={d.name}>
              <button type="button" className="dr-head" onClick={() => setOpen(isOpen ? null : d.name)}>
                <div className="dr-title">
                  <span className="dr-name">{d.name}</span>
                  <span className="dr-sub mono">
                    {d.items.length} product{d.items.length === 1 ? '' : 's'} · {taka(d.value)} sold
                  </span>
                </div>
                <div className="dr-nums">
                  <div className="dr-num">
                    <strong>{d.sold}</strong>
                    <span className="mono">SOLD</span>
                  </div>
                  <div className="dr-num">
                    <strong>{d.left}</strong>
                    <span className="mono">IN STOCK</span>
                  </div>
                  <div className="dr-num">
                    <strong>{d.pct}%</strong>
                    <span className="mono">SOLD THROUGH</span>
                  </div>
                </div>
                <div className="dr-bar" aria-hidden="true"><i style={{ width: `${d.pct}%` }} /></div>
                {d.untracked > 0 && (
                  <div className="dr-warn mono">
                    {d.untracked} product{d.untracked === 1 ? ' has' : 's have'} no stock count, so it isn't in IN STOCK or SOLD THROUGH
                  </div>
                )}
              </button>

              {isOpen && (
                <div className="dr-items">
                  {d.items.map(({ product: p, sold, left, sizes, value }) => (
                    <div className="dr-item" key={p.id}>
                      <div className="dr-thumb">
                        {p.images?.[0] && <img src={imgUrl(p.images[0], { w: 120 })} alt="" />}
                      </div>
                      <div className="dr-info">
                        <div className="dr-pname">{p.name}</div>
                        <div className="dr-sub mono">{p.variant ? `${p.variant} · ` : ''}{taka(value)}</div>
                        <div className="dr-sizes">
                          {sizes.map((z) => (
                            <span key={z.size} className={`dr-size mono ${z.left === 0 ? 'out' : ''}`}>
                              <b>{z.size}</b> {z.sold} sold{z.left != null ? ` · ${z.left} left` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="dr-pnums mono">
                        <div><strong>{sold}</strong> sold</div>
                        <div className="dim">{left == null ? 'not counted' : `${left} left`}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
