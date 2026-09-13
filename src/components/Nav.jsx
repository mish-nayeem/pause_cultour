import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { fetchProducts } from '../lib/products.js'
import { IconLock } from './Icons.jsx'
import './nav.css'

export default function Nav({ overlay = false }) {
  const { count } = useCart()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState([])

  // Categories come from what's actually in the catalog rather than a fixed
  // list, so the menu can never offer a category with nothing behind it.
  useEffect(() => {
    let active = true
    fetchProducts().then(({ products }) => {
      if (!active) return
      const found = [...new Set(products.map((p) => p.category).filter(Boolean))]
      setCategories(found.sort())
    })
    return () => { active = false }
  }, [])

  function go(category) {
    setOpen(false)
    navigate(category === 'ALL' ? '/shop' : `/shop?c=${encodeURIComponent(category)}`)
  }

  const hasNew = true

  return (
    <div
      className={`nav-wrap ${overlay ? 'overlay' : ''}`}
      onMouseLeave={() => setOpen(false)}
    >
      <header className="site-header">
        <Link to="/" className="logo display">PAUSE</Link>
        <nav>
          <ul>
            <li onMouseEnter={() => setOpen(true)}>
              <Link to="/shop" className={open ? 'dim' : ''}>SHOP</Link>
            </li>
            <li onMouseEnter={() => setOpen(false)}>
              <Link to="/shop">DROPS</Link>
            </li>
            <li onMouseEnter={() => setOpen(false)}>
              <a href="#">ADVICE</a>
            </li>
            <li onMouseEnter={() => setOpen(false)}>
              <Link to="/cart" className="cart">CART ({count})</Link>
            </li>
            <li onMouseEnter={() => setOpen(false)}>
              <Link to="/admin" className="admin-link" title="Admin" aria-label="Admin">
                <IconLock width="14" height="14" />
              </Link>
            </li>
          </ul>
        </nav>
      </header>

      {open && categories.length > 0 && (
        <div className="cat-menu" onMouseEnter={() => setOpen(true)}>
          <div className="cat-inner mono">
            <button onClick={() => go('ALL')}>ALL</button>
            {hasNew && <button onClick={() => go('NEW')}>NEW</button>}
            {categories.map((c) => (
              <button key={c} onClick={() => go(c)}>{c}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
