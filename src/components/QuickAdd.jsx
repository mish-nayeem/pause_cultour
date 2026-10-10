import { useEffect, useRef, useState } from 'react'
import { useCart } from '../context/CartContext.jsx'
import { availableSizes, roomLeft } from '../lib/stock.js'
import { sortSizes } from './ShopFilter.jsx'
import './quick-add.css'

// The + in the corner of a product photo on the grid: adds to the cart
// without opening the product. One size left → straight in. Several → a row
// of sizes across the bottom of the photo to pick from. It sits inside the
// card's link, so every tap here stops the link from opening the product.
export default function QuickAdd({ product }) {
  const { items, addItem } = useCart()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('') // '' | 'added' | 'max'
  const ref = useRef(null)
  const sizes = sortSizes(availableSizes(product))

  useEffect(() => {
    if (!open) return
    function away(e) {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (sizes.length === 0) return null

  function stop(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  function flash(kind) {
    setNote(kind)
    setTimeout(() => setNote(''), 1500)
  }

  function add(size) {
    setOpen(false)
    // Same rule as the product page: never more in the cart than exists.
    if (roomLeft(product, size, items) < 1) return flash('max')
    addItem(product, size, 1)
    flash('added')
  }

  return (
    <div className="qa" ref={ref} onClick={stop}>
      {open && (
        <div className="qa-sizes mono" role="group" aria-label={`Add ${product.name} — pick a size`}>
          {sizes.map((s) => (
            <button key={s} type="button" onClick={(e) => { stop(e); add(s) }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {note && <span className="qa-note mono">{note === 'added' ? 'ADDED ✓' : 'NO MORE LEFT'}</span>}

      <button
        type="button"
        className={`qa-plus ${open ? 'on' : ''}`}
        aria-label={sizes.length === 1 ? `Add ${product.name} to cart` : `Add ${product.name} to cart — choose a size`}
        aria-expanded={sizes.length > 1 ? open : undefined}
        onClick={(e) => {
          stop(e)
          if (sizes.length === 1) add(sizes[0])
          else setOpen((o) => !o)
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
