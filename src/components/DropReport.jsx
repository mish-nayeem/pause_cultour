import { useMemo, useState } from 'react'
import { imgUrl } from '../lib/images.js'
import { dropKey } from '../lib/lookbook.js'
import { totalStock, starSizes } from '../lib/stock.js'
import RestockStar from './RestockStar.jsx'
import './drop-report.css'

function taka(n) {
  return '৳ ' + Math.round(Number(n || 0)).toLocaleString()
}

const NO_DROP = 'No drop'

// One colour per drop, round and round, so each reads as its own block.
const DROP_COLOURS = ['#2F8CFF', '#F0457A', '#1FB57A', '#F2A516', '#7C6CFF', '#13B5C8']

// How full a product still is: plenty, running low, or gone.
function levelOf(left) {
  if (left == null) return ''
  if (left === 0) return 'out'
  if (left <= 5) return 'low'
  return 'ok'
}

// Products → Stock & sales. Everything in one place: how many products, how
// many pieces are left and what they're worth, and what has sold — then the
// same drop by drop. Tap "pieces in stock" or a drop to see which products
// still have pieces, each with its total left (all sizes together) and a
// small photo. Cancelled orders don't count; every other order does, since
// its pieces have already left the stock.
export default function DropReport({ products, orders }) {
  const [open, setOpen] = useState(null) // a drop's name | 'all' | null

  const { totals, drops } = useMemo(() => {
    // Sold per product, from every order that wasn't cancelled.
    const sold = new Map()
    let soldUnits = 0
    let soldValue = 0
    for (const o of orders) {
      if (o.status === 'cancelled') continue
      for (const it of o.order_items || []) {
        const id = String(it.product_id)
        const row = sold.get(id) || { units: 0, value: 0 }
        const qty = Number(it.qty) || 0
        const value = qty * Number(it.price || 0)
        row.units += qty
        row.value += value
        soldUnits += qty
        soldValue += value
        sold.set(id, row)
      }
    }

    const totals = { products: products.length, left: 0, stockValue: 0, soldUnits, soldValue, untracked: 0 }
    const groups = new Map()

    for (const p of products) {
      const name = p.drop_name && p.drop_name.trim() ? p.drop_name.trim() : NO_DROP
      const key = name === NO_DROP ? '' : dropKey(name)
      const g = groups.get(key) || { name, items: [], sold: 0, value: 0, left: 0, countedSold: 0, untracked: 0 }
      const s = sold.get(String(p.id)) || { units: 0, value: 0 }
      const left = totalStock(p)

      g.items.push({ product: p, sold: s.units, value: s.value, left })
      g.sold += s.units
      g.value += s.value
      if (left == null) {
        g.untracked += 1
        totals.untracked += 1
      } else {
        g.left += left
        g.countedSold += s.units
        totals.left += left
        totals.stockValue += left * Number(p.price || 0)
      }
      groups.set(key, g)
    }

    const drops = [...groups.values()]
      .map((g) => ({
        ...g,
        // Share that's gone, from products with a stock count only — one
        // without a count has no "left" to compare its sales against.
        pct: g.countedSold + g.left > 0 ? Math.round((g.countedSold / (g.countedSold + g.left)) * 100) : 0,
      }))
      // Real drops by sales; the products without one at the end.
      .sort((a, b) => (a.name === NO_DROP) - (b.name === NO_DROP) || b.sold - a.sold)

    return { totals, drops }
  }, [products, orders])

  // Which products still have pieces: most left first. One without a stock
  // count is listed too, marked as such, since it's still for sale.
  function remaining(items) {
    return items
      .filter((i) => i.left == null || i.left > 0)
      .sort((a, b) => (b.left ?? -1) - (a.left ?? -1))
  }

  const allItems = drops.flatMap((d) => d.items)

  return (
    <section className="panel dr-panel">
      <div className="panel-label mono" style={{ marginBottom: '6px' }}>STOCK &amp; SALES</div>
      <div className="panel-note" style={{ marginBottom: '16px' }}>
        Everything at a glance, then drop by drop. Tap <b>Pieces in stock</b> or a drop to see which
        products are left. Cancelled orders don't count.
      </div>

      <div className="dr-totals">
        <div className="dr-total t-blue">
          <span className="mono">PRODUCTS</span>
          <strong>{totals.products}</strong>
        </div>
        <button
          type="button"
          className={`dr-total dr-total-btn t-green ${open === 'all' ? 'on' : ''}`}
          onClick={() => setOpen(open === 'all' ? null : 'all')}
        >
          <span className="mono">PIECES IN STOCK</span>
          <strong>{totals.left}</strong>
          <em className="mono">{open === 'all' ? 'Hide list ↑' : 'See which ↓'}</em>
        </button>
        <div className="dr-total t-amber">
          <span className="mono">STOCK VALUE</span>
          <strong>{taka(totals.stockValue)}</strong>
          <em className="mono">at full price</em>
        </div>
        <div className="dr-total t-pink">
          <span className="mono">SOLD</span>
          <strong>{taka(totals.soldValue)}</strong>
          <em className="mono">{totals.soldUnits} pieces</em>
        </div>
      </div>

      {totals.untracked > 0 && (
        <div className="dr-warn mono" style={{ marginBottom: '12px' }}>
          {totals.untracked} product{totals.untracked === 1 ? ' has' : 's have'} no stock count, so
          {totals.untracked === 1 ? ' it isn’t' : ' they aren’t'} in pieces in stock or stock value
        </div>
      )}

      {open === 'all' && <LeftList items={remaining(allItems)} />}

      <div className="dr-label mono">BY DROP</div>

      {drops.length === 0 && <div className="empty mono">No products yet.</div>}

      <div className="dr-list">
        {drops.map((d, i) => {
          const isOpen = open === d.name
          return (
            <div
              className={`dr-card ${isOpen ? 'open' : ''}`}
              key={d.name}
              style={{ '--acc': d.name === NO_DROP ? '#8B8A82' : DROP_COLOURS[i % DROP_COLOURS.length] }}
            >
              <button type="button" className="dr-head" onClick={() => setOpen(isOpen ? null : d.name)}>
                <div className="dr-title">
                  <span className="dr-name">{d.name}</span>
                  <span className="dr-sub mono">
                    {d.items.length} product{d.items.length === 1 ? '' : 's'} · {taka(d.value)} sold
                  </span>
                </div>
                <div className="dr-nums">
                  <div className="dr-num n-sold">
                    <strong>{d.sold}</strong>
                    <span className="mono">SOLD</span>
                  </div>
                  <div className="dr-num n-left">
                    <strong>{d.left}</strong>
                    <span className="mono">LEFT</span>
                  </div>
                  <div className="dr-num n-pct">
                    <strong>{d.pct}%</strong>
                    <span className="mono">SOLD THROUGH</span>
                  </div>
                </div>
                <div className="dr-bar" aria-hidden="true"><i style={{ width: `${d.pct}%` }} /></div>
                <div className="dr-more mono">{isOpen ? 'Hide products ↑' : 'See what’s left ↓'}</div>
              </button>

              {isOpen && <LeftList items={remaining(d.items)} inCard />}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// Products with pieces left: small photo, name and colour, total left.
function LeftList({ items, inCard = false }) {
  return (
    <div className={`dr-items ${inCard ? '' : 'dr-items-solo'}`}>
      {items.length === 0 && <div className="empty mono" style={{ padding: '12px 0' }}>Everything here has sold out.</div>}
      {items.map(({ product: p, sold, left }) => (
        <div className="dr-item" key={p.id}>
          <div className="dr-thumb">
            {p.images?.[0] && <img src={imgUrl(p.images[0], { w: 120 })} alt="" loading="lazy" />}
            <RestockStar sizes={starSizes(p)} />
          </div>
          <div className="dr-info">
            <div className="dr-pname">{p.name}</div>
            <div className="dr-sub mono">
              {p.variant ? `${p.variant} · ` : ''}{sold} sold
            </div>
          </div>
          <div className={`dr-pnums mono lv-${levelOf(left)}`}>
            {left == null ? (
              <div className="dim">not counted</div>
            ) : (
              <>
                <strong>{left}</strong>
                <div className="dim">left</div>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
