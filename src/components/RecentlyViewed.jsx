import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QuickAdd from './QuickAdd.jsx'
import { CardPhoto } from './CardPhotos.jsx'
import ColourSwatches from './ColourSwatches.jsx'
import { fetchProducts, cardPhotos } from '../lib/products.js'
import { recentIds } from '../lib/recent.js'
import { CardPrice, SaleBadge } from './SalePrice.jsx'
import { isAllSoldOut } from '../lib/stock.js'
import './you-may-like.css'

// Under You may like: the products this visitor opened before this one,
// newest first — kept in this browser only. Laid out like You may like.
export default function RecentlyViewed({ currentId }) {
  const [products, setProducts] = useState([])
  const [all, setAll] = useState([])

  useEffect(() => {
    let cancelled = false
    const ids = recentIds().filter((id) => id !== String(currentId))
    if (!ids.length) {
      setProducts([])
      return
    }
    fetchProducts().then(({ products: all }) => {
      if (cancelled) return
      const byId = new Map(all.map((p) => [String(p.id), p]))
      setAll(all)
      setProducts(ids.map((id) => byId.get(id)).filter(Boolean))
    })
    return () => { cancelled = true }
  }, [currentId])

  if (products.length === 0) return null

  return (
    <section className="yml">
      <h2 className="display">Recently viewed</h2>

      <div className="yml-grid">
        {products.map((p) => (
          <Link to={`/product/${p.id}${isAllSoldOut(p) ? '?notify=1' : ''}`} className="yml-card" key={p.id}>
            <div className="yml-thumb">
              <CardPhoto images={cardPhotos(p, all)} alt={p.name} loading="lazy" />
              {isAllSoldOut(p) ? (
                <span className="snew out mono"><i className="rec" />SOLD OUT</span>
              ) : (
                p.isNew && <span className="snew mono"><i className="rec" />NEW</span>
              )}
              <SaleBadge product={p} />
              <QuickAdd product={p} />
            </div>
            <div className="yml-info">
              <div className="card-top">
                <div className="yml-name">{p.name}</div>
                {isAllSoldOut(p) && <span className="card-notify mono">NOTIFY ME</span>}
              </div>
              <ColourSwatches product={p} all={all} />
              <div className="yml-meta mono">
                <span>{p.variant}</span>
                <CardPrice product={p} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
