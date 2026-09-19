import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Pager from './Pager.jsx'
import { fetchProducts } from '../lib/products.js'
import { cld } from '../lib/cloudinary.js'
import { scrollToTarget } from '../lib/smoothScroll.js'
import { isAllSoldOut } from '../lib/stock.js'
import './you-may-like.css'

const PAGE_SIZE = 8

// Everything else in the catalogue, newest upload first, a page at a time.
export default function YouMayLike({ currentId }) {
  const [products, setProducts] = useState([])
  const [page, setPage] = useState(1)
  const topRef = useRef(null)

  // The catalogue comes back oldest first, so the newest are at the end.
  useEffect(() => {
    let cancelled = false
    fetchProducts().then(({ products: all }) => {
      if (!cancelled) setProducts([...all].reverse())
    })
    return () => { cancelled = true }
  }, [])

  // Arriving on another product starts the list over.
  useEffect(() => setPage(1), [currentId])

  const others = products.filter((p) => String(p.id) !== String(currentId))
  const totalPages = Math.max(1, Math.ceil(others.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const visible = others.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  function goToPage(n) {
    setPage(n)
    if (topRef.current) scrollToTarget(topRef.current, { offset: -90 })
  }

  if (others.length === 0) return null

  return (
    <section className="yml" ref={topRef}>
      <h2 className="display">You may like</h2>

      <div className="yml-grid">
        {visible.map((p) => (
          <Link to={`/product/${p.id}`} className="yml-card" key={p.id}>
            <div className="yml-thumb">
              <img src={cld(p.images[0], { w: 500 })} alt={p.name} loading="lazy" />
              {p.isNew && <span className="yml-new mono">NEW</span>}
            </div>
            <div className="yml-info">
              {isAllSoldOut(p) && <div className="yml-out mono">SOLD OUT</div>}
              <div className="yml-name">{p.name}</div>
              <div className="yml-meta mono">
                <span>{p.variant}</span>
                <span>৳ {p.price.toLocaleString()}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Pager page={current} totalPages={totalPages} onChange={goToPage} />
    </section>
  )
}
