import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { IconSearch } from './Icons.jsx'
import { fetchProducts } from '../lib/products.js'
import { imgUrl } from '../lib/images.js'
import { CardPrice } from './SalePrice.jsx'
import './search-overlay.css'

// Full-screen search over the catalog: name, colour, category, drop and SKU.
// Every word typed has to match somewhere, so "black tee" finds black tees.
// The catalog is small, so it's searched in the browser as you type.
export default function SearchOverlay({ onClose }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState(null)

  useEffect(() => {
    inputRef.current?.focus()
    fetchProducts().then(({ products }) => setProducts(products))
  }, [])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length || !products) return []
    return products.filter((p) => {
      const hay = [p.name, p.variant, p.category, p.drop, p.sku].filter(Boolean).join(' ').toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [query, products])

  function open(p) {
    onClose()
    navigate(`/product/${p.id}`)
  }

  // On <body>, above the nav and the floating FILTER/CART pills.
  return createPortal(
    <div className="so" role="dialog" aria-modal="true" aria-label="Search" data-lenis-prevent>
      <div className="so-bar">
        <IconSearch className="so-icon" width="20" height="20" aria-hidden="true" />
        <input
          ref={inputRef}
          className="so-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products"
          aria-label="Search products"
          enterKeyHint="search"
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) open(results[0]) }}
        />
        <button type="button" className="so-close mono" onClick={onClose}>CLOSE</button>
      </div>

      <div className="so-body">
        {query.trim() && products === null && <p className="so-msg mono">Searching…</p>}
        {query.trim() && products && results.length === 0 && (
          <p className="so-msg mono">Nothing found for “{query.trim()}”.</p>
        )}
        {!query.trim() && <p className="so-msg mono">Type a name, colour, category or drop.</p>}

        <div className="so-results">
          {results.map((p) => (
            <button type="button" className="so-item" key={p.id} onClick={() => open(p)}>
              <span className="so-thumb">
                {p.images[0] && <img src={imgUrl(p.images[0], { w: 160 })} alt="" loading="lazy" />}
              </span>
              <span className="so-text">
                <span className="so-name">{p.name}</span>
                <span className="so-meta mono">{[p.variant, p.drop].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="so-price mono"><CardPrice product={p} /></span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
