import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Pager from './Pager.jsx'
import { CardPhoto } from './CardPhotos.jsx'
import ColourSwatches from './ColourSwatches.jsx'
import QuickAdd from './QuickAdd.jsx'
import { fetchProducts, oneColourEach, cardPhotos } from '../lib/products.js'
import { CardPrice, SaleBadge } from './SalePrice.jsx'
import { scrollToTarget } from '../lib/smoothScroll.js'
import { isAllSoldOut } from '../lib/stock.js'
import './you-may-like.css'

const PAGE_SIZE = 8

// Everything else in the catalogue, newest upload first, a page at a time.
export default function YouMayLike({ currentId }) {
  const [products, setProducts] = useState([])
  const [page, setPage] = useState(1)
  const topRef = useRef(null)

  // The catalogue already comes back newest first.
  useEffect(() => {
    let cancelled = false
    fetchProducts().then(({ products: all }) => {
      if (!cancelled) setProducts(all)
    })
    return () => { cancelled = true }
  }, [])

  // Arriving on another product starts the list over.
  useEffect(() => setPage(1), [currentId])

  // Not this piece in any colour, and one card for each other piece.
  const viewing = products.find((p) => String(p.id) === String(currentId))
  const group = (viewing?.colourGroup || '').trim().toUpperCase()
  const name = (viewing?.name || '').trim().toLowerCase()
  const samePiece = (p) => (group && (p.colourGroup || '').trim().toUpperCase() === group) || (name && (p.name || '').trim().toLowerCase() === name)
  const others = oneColourEach(
    products.filter((p) => String(p.id) !== String(currentId) && !samePiece(p)),
    (p) => !isAllSoldOut(p)
  )
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
          <Link to={`/product/${p.id}${isAllSoldOut(p) ? '?notify=1' : ''}`} className="yml-card" key={p.id}>
            <div className="yml-thumb">
              <CardPhoto images={cardPhotos(p, products)} alt={p.name} loading="lazy" />
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
              <ColourSwatches product={p} all={products} />
              <div className="yml-meta mono">
                <span>{p.variant}</span>
                <CardPrice product={p} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Pager page={current} totalPages={totalPages} onChange={goToPage} />
    </section>
  )
}
