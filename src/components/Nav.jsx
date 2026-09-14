import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { fetchProducts } from '../lib/products.js'
import { IconLock } from './Icons.jsx'
import './nav.css'

export default function Nav({ overlay = false }) {
  const { count } = useCart()
  const navigate = useNavigate()
  const location = useLocation()

  const [catOpen, setCatOpen] = useState(false)   // desktop hover dropdown
  const [menuOpen, setMenuOpen] = useState(false) // mobile panel
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

  // Any navigation closes both menus — otherwise the mobile panel stays open
  // over the page it just took you to.
  useEffect(() => {
    setMenuOpen(false)
    setCatOpen(false)
  }, [location.pathname, location.search])

  // The mobile panel covers the screen, so the page behind it shouldn't scroll.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  function go(category) {
    navigate(category === 'ALL' ? '/shop' : `/shop?c=${encodeURIComponent(category)}`)
  }

  const catList = ['ALL', 'NEW', ...categories]

  return (
    <div
      className={`nav-wrap ${overlay ? 'overlay' : ''}`}
      onMouseLeave={() => setCatOpen(false)}
    >
      <header className="site-header">
        <Link to="/" className="logo display">PAUSE</Link>

        {/* Desktop links */}
        <nav className="desk-nav">
          <ul>
            <li onMouseEnter={() => setCatOpen(true)}>
              <Link to="/shop" className={catOpen ? 'dim' : ''}>SHOP</Link>
            </li>
            <li onMouseEnter={() => setCatOpen(false)}><Link to="/shop">DROPS</Link></li>
            <li onMouseEnter={() => setCatOpen(false)}><a href="#">ADVICE</a></li>
            <li onMouseEnter={() => setCatOpen(false)}>
              <Link to="/cart" className="cart">CART ({count})</Link>
            </li>
            <li onMouseEnter={() => setCatOpen(false)}>
              <Link to="/admin" className="admin-link" title="Admin" aria-label="Admin">
                <IconLock width="14" height="14" />
              </Link>
            </li>
          </ul>
        </nav>

        {/* Mobile: cart stays visible, everything else moves into the panel so
            the pill doesn't cram five items onto a 360px screen. */}
        <div className="mob-right">
          <Link to="/cart" className="cart mono">CART ({count})</Link>
          <button
            className={`burger ${menuOpen ? 'on' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      {/* Desktop hover dropdown */}
      {catOpen && catList.length > 0 && (
        <div className="cat-menu" onMouseEnter={() => setCatOpen(true)}>
          <div className="cat-inner mono">
            {catList.map((c) => (
              <button key={c} onClick={() => go(c)}>{c}</button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile panel */}
      {menuOpen && (
        <div className="mob-panel">
          <div className="mob-section mono">SHOP</div>
          <div className="mob-cats mono">
            {catList.map((c) => (
              <button key={c} onClick={() => go(c)}>{c}</button>
            ))}
          </div>

          <div className="mob-links mono">
            <Link to="/shop">DROPS</Link>
            <a href="#">ADVICE</a>
            <Link to="/cart">CART ({count})</Link>
            <Link to="/admin" className="mob-admin">
              <IconLock width="13" height="13" /> ADMIN
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
