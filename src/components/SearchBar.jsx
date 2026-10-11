import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProducts } from '../lib/products.js'
import { imgUrl } from '../lib/images.js'
import { IconSearch } from './Icons.jsx'
import { CardPrice } from './SalePrice.jsx'
import './search-bar.css'

// Product search that opens right under the nav — the page stays where it
// is, nothing new opens. Searches name, colour, category, drop and SKU;
// every word typed has to match, so "black tee" finds black tees. The
// catalog is small, so it's searched in the browser as you type.
export default function SearchBar({ onClose }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState(null)

  useEffect(() => {
    inputRef.current?.focus()
    fetchProducts().then(({ products }) => setProducts(products))
  }, [])

  // Esc, or a tap anywhere outside the bar, closes it.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    function away(e) {
      if (boxRef.current && !boxRef.current.contains(e.target) && !e.target.closest('.search-btn')) onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', away)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', away)
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

  const q = query.trim()

  return (
    <div className="sb" ref={boxRef} role="search">
      <div className="sb-bar">
        <IconSearch className="sb-icon" width="17" height="17" aria-hidden="true" />
        <input
          ref={inputRef}
          className="sb-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products"
          aria-label="Search products"
          enterKeyHint="search"
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) open(results[0]) }}
        />
        <button type="button" className="sb-close mono" onClick={onClose} aria-label="Close search">✕</button>
      </div>

      {q && (
        <div className="sb-results" data-lenis-prevent>
          {products === null && <p className="sb-msg mono">Searching…</p>}
          {products && results.length === 0 && <p className="sb-msg mono">Nothing found for “{q}”.</p>}
          {results.map((p) => (
            <button type="button" className="sb-item" key={p.id} onClick={() => open(p)}>
              <span className="sb-thumb">
                {p.images[0] && <img src={imgUrl(p.images[0], { w: 120 })} alt="" loading="lazy" />}
              </span>
              <span className="sb-text">
                <span className="sb-name">{p.name}</span>
                <span className="sb-meta mono">{[p.variant, p.drop].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="sb-price mono"><CardPrice product={p} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
