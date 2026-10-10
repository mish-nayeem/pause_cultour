import { useEffect, useState } from 'react'
import { timeLeft } from '../lib/sales.js'
import './sale-price.css'

function taka(n) {
  return '৳ ' + Number(n).toLocaleString()
}

// A product's price as the shop shows it. Without a sale it's just the
// number; during one, the sale price with the shelf price struck through.
export function CardPrice({ product }) {
  if (!product.sale) return <span>{taka(product.price)}</span>

  return (
    <span className="sp-card">
      <s className="sp-was">{taka(product.originalPrice)}</s>
      <span className="sp-now">{taka(product.price)}</span>
    </span>
  )
}

// The "-20%" chip on a card's photo.
export function SaleBadge({ product }) {
  if (!product.sale) return null
  return <span className="sp-badge mono">-{product.sale.percent}%</span>
}

// The product page: price, the saving, and a countdown to the end.
export function ProductPrice({ product }) {
  const [now, setNow] = useState(() => Date.now())
  const endsAt = product.sale?.endsAt

  useEffect(() => {
    if (!endsAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [endsAt])

  if (!product.sale) return <div className="price mono">{taka(product.price)}</div>

  const left = timeLeft(endsAt, now)

  return (
    <div className="sp-block">
      <div className="price mono sp-row">
        <span className="sp-now">{taka(product.price)}</span>
        <s className="sp-was">{taka(product.originalPrice)}</s>
        <span className="sp-badge sp-inline mono">-{product.sale.percent}%</span>
      </div>
      <div className="sp-ends mono">
        {left ? (
          <>
            {product.sale.name ? `${product.sale.name.toUpperCase()} · ` : 'SALE · '}ENDS IN <b>{left}</b>
          </>
        ) : (
          'SALE ENDED — REFRESH FOR THE CURRENT PRICE'
        )}
      </div>
    </div>
  )
}
