import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProducts } from '../lib/products.js'
import { imgUrl } from '../lib/images.js'
import { IconSearch } from './Icons.jsx'
import { CardPrice } from './SalePrice.jsx'
import { recentIds } from '../lib/recent.js'
import './search-bar.css'

// The catalog, kept after the first open so the next one shows its photos
// straight away instead of waiting on the network again.
let cachedProducts = null

// Product search that opens right under the nav — the page stays where it
// is, nothing new opens. Searches name, colour, category, drop and SKU;
// every word typed has to match, so "black tee" finds black tees. The
// catalog is small, so it's searched in the browser as you type.
export default function SearchBar({ onClose }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const innerRef = useRef(null)
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState(cachedProducts)
  // The panel's height follows its content with a transition, so it opens
  // as one smooth drop — before, the bar appeared first and the photos
  // jumped in under it once they'd loaded. Starts at 0 to grow from nothing.
  const [height, setHeight] = useState(0)

  useEffect(() => {
    // preventScroll: focusing mustn't make the page jump to the input.
    inputRef.current?.focus({ preventScroll: true })
    fetchProducts().then(({ products }) => {
      cachedProducts = products
      setProducts(products)
    })
  }, [])

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    // The first measure waits a frame, so the 0 → full height change is
    // one the browser animates rather than skips.
    const raf = requestAnimationFrame(() => setHeight(el.offsetHeight))
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
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

  // Before anything's typed: what this visitor last looked at, then the
  // newest products (those marked NEW first).
  const recent = useMemo(() => {
    if (!products) return []
    const byId = Object.fromEntries(products.map((p) => [String(p.id), p]))
    return recentIds().map((id) => byId[id]).filter(Boolean).slice(0, 6)
  }, [products])

  const launches = useMemo(() => {
    if (!products) return []
    const fresh = products.filter((p) => p.isNew)
    return (fresh.length ? fresh : products).slice(0, 6)
  }, [products])

  function open(p) {
    onClose()
    navigate(`/product/${p.id}`)
  }

  const q = query.trim()

  return (
    <div className="sb" ref={boxRef} role="search" style={{ height }}>
      <div className="sb-inner" ref={innerRef}>
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

      {/* Still loading: grey tiles the same size as the real ones, so the
          panel opens to its full height in one go instead of growing again
          once the photos arrive. */}
      {!q && !products && (
        <div className="sb-results sb-idle" aria-hidden="true">
          {recentIds().length > 0 && (
            <section className="sb-sec">
              <div className="sb-sec-label mono">RECENTLY VIEWED</div>
              <div className="sb-tiles">
                {recentIds().slice(0, 6).map((id) => <span className="sb-tile sb-ghost" key={id}><span className="sb-tile-img" /><span className="sb-tile-name">&nbsp;</span></span>)}
              </div>
            </section>
          )}
          <section className="sb-sec">
            <div className="sb-sec-label mono">NEW LAUNCHES</div>
            <div className="sb-tiles">
              {Array.from({ length: 6 }, (_, i) => <span className="sb-tile sb-ghost" key={i}><span className="sb-tile-img" /><span className="sb-tile-name">&nbsp;</span></span>)}
            </div>
          </section>
        </div>
      )}

      {!q && products && (recent.length > 0 || launches.length > 0) && (
        <div className="sb-results sb-idle" data-lenis-prevent>
          {recent.length > 0 && (
            <section className="sb-sec">
              <div className="sb-sec-label mono">RECENTLY VIEWED</div>
              <div className="sb-tiles">
                {recent.map((p) => <Tile key={p.id} p={p} onPick={open} />)}
              </div>
            </section>
          )}
          {launches.length > 0 && (
            <section className="sb-sec">
              <div className="sb-sec-label mono">NEW LAUNCHES</div>
              <div className="sb-tiles">
                {launches.map((p) => <Tile key={p.id} p={p} onPick={open} />)}
              </div>
            </section>
          )}
        </div>
      )}

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
    </div>
  )
}

// A small photo with the name under it.
function Tile({ p, onPick }) {
  return (
    <button type="button" className="sb-tile" onClick={() => onPick(p)}>
      <span className="sb-tile-img">
        {p.images[0] && <img src={imgUrl(p.images[0], { w: 200 })} alt="" loading="lazy" />}
      </span>
      <span className="sb-tile-name">{p.name}</span>
    </button>
  )
}
