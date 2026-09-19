import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { fetchMenuCategories, fetchMenuDrops } from '../lib/navCategories.js'
import { IconUser } from './Icons.jsx'
import { watchUser } from '../lib/auth.js'
import { isAdminEmail } from '../lib/admin.js'
import './nav.css'

// The mark is a flat PNG, so its thickness is faked by stacking copies a
// fraction of a pixel apart along Z — edge-on they read as one solid slab.
// Centring the stack keeps the turn's axis through the middle of that slab.
const LOGO_LAYERS = 6
const LOGO_STEP = 1
const LOGO_HALF_DEPTH = ((LOGO_LAYERS - 1) * LOGO_STEP) / 2

export default function Nav({ overlay = false }) {
  const { count } = useCart()
  const navigate = useNavigate()
  const location = useLocation()

  const [openMenu, setOpenMenu] = useState(null)  // null | 'shop' | 'drops'
  const [menuOpen, setMenuOpen] = useState(false) // mobile panel
  const [categories, setCategories] = useState([])
  const [drops, setDrops] = useState([])

  const [user, setUser] = useState(null)

  const closeTimer = useRef(null)

  // Closing on a delay rather than the instant the pointer leaves: the trip
  // from a nav link down to the panel clips the corner of the gap between them,
  // and without this grace period the menu shuts halfway there.
  function showMenu(name) {
    clearTimeout(closeTimer.current)
    setOpenMenu(name)
  }

  function scheduleClose() {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpenMenu(null), 220)
  }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => watchUser(setUser), [])

  // The person icon leads to wherever this visitor belongs: the admin panel
  // for the owner, their account for a customer, the login page for a guest.
  const accountLink = !user ? '/login' : isAdminEmail(user.email) ? '/admin' : '/account'
  const accountLabel = !user ? 'Log in' : isAdminEmail(user.email) ? 'Admin panel' : 'My account'

  // Both menus are admin-managed lists, so an entry can be pulled the day it
  // sells out without touching the products behind it.
  useEffect(() => {
    let active = true

    Promise.all([fetchMenuCategories(), fetchMenuDrops()]).then(([cats, drps]) => {
      if (!active) return
      setCategories(cats)
      setDrops(drps)
    })

    return () => { active = false }
  }, [])

  // Any navigation closes both menus — otherwise the mobile panel stays open
  // over the page it just took you to.
  useEffect(() => {
    setMenuOpen(false)
    setOpenMenu(null)
  }, [location.pathname, location.search])

  // The mobile panel covers the screen, so the page behind it shouldn't scroll.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  // Every page but the homepage gets a way back. React Router numbers each
  // history entry; idx 0 means this page was the first one opened in the tab
  // (a shared link, a fresh bookmark), where navigate(-1) would leave the site.
  const showBack = location.pathname !== '/'

  function goBack() {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/')
  }

  function goCategory(category) {
    navigate(category === 'ALL' ? '/shop' : `/shop?c=${encodeURIComponent(category)}`)
  }

  function goDrop(drop) {
    navigate(`/shop?d=${encodeURIComponent(drop)}`)
  }

  const catList = ['ALL', 'NEW', ...categories]
  const openList = openMenu === 'drops' ? drops : catList
  const openGo = openMenu === 'drops' ? goDrop : goCategory

  return (
    <div
      className={`nav-wrap ${overlay ? 'overlay' : ''} ${showBack ? 'has-back' : ''}`}
      onMouseLeave={scheduleClose}
    >
      {showBack && (
        <button type="button" className="back-btn" onClick={goBack} aria-label="Go back">
          <span className="back-arrow" aria-hidden="true" />
          <span className="back-text">BACK</span>
        </button>
      )}

      <header className="site-header">
        <Link to="/" className="logo" aria-label="PAUSE — home">
          <span className="logo-3d">
            {Array.from({ length: LOGO_LAYERS }, (_, i) => {
              const z = LOGO_HALF_DEPTH - i * LOGO_STEP

              // Each layer is doubled: one copy faces front, one faces back.
              // With backface-visibility hidden only the copy pointing at the
              // viewer paints, so the far half of the turn shows the mark the
              // right way round instead of mirrored. The back copy takes the
              // shading of the layer it becomes when seen from that side —
              // depth order reverses once you're behind the slab.
              return [0, 180].map((face) => (
                <img
                  key={`${i}-${face}`}
                  src="/logo.png"
                  alt=""
                  aria-hidden="true"
                  style={{
                    transform: `translateZ(${z}px) rotateY(${face}deg)`,
                    filter: `brightness(${
                      1 - (face === 0 ? i : LOGO_LAYERS - 1 - i) * 0.07
                    })`,
                  }}
                />
              ))
            })}
          </span>
        </Link>

        {/* Desktop links */}
        <nav className="desk-nav">
          <ul>
            <li onMouseEnter={() => showMenu('shop')}>
              <Link to="/shop" className={openMenu === 'shop' ? 'dim' : ''}>SHOP</Link>
            </li>
            <li onMouseEnter={() => showMenu(drops.length > 0 ? 'drops' : null)}>
              <Link to="/shop" className={openMenu === 'drops' ? 'dim' : ''}>DROPS</Link>
            </li>
            <li onMouseEnter={() => showMenu(null)}><Link to="/about">ABOUT US</Link></li>
            <li onMouseEnter={() => showMenu(null)}>
              <Link to="/cart" className="cart">CART ({count})</Link>
            </li>
            <li onMouseEnter={() => showMenu(null)}>
              <Link to={accountLink} className="admin-link" title={accountLabel} aria-label={accountLabel}>
                <IconUser width="15" height="15" />
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

      {/* Desktop hover dropdown — same panel for both menus, so moving between
          SHOP and DROPS swaps the contents instead of stacking two boxes. */}
      {openMenu && openList.length > 0 && (
        <div className="cat-menu" onMouseEnter={() => showMenu(openMenu)}>
          <div className="cat-inner mono">
            {openList.map((c) => (
              <button key={c} onClick={() => openGo(c)}>{c}</button>
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
              <button key={c} onClick={() => goCategory(c)}>{c}</button>
            ))}
          </div>

          {drops.length > 0 && (
            <>
              <div className="mob-section mono">DROPS</div>
              <div className="mob-cats mono">
                {drops.map((d) => (
                  <button key={d} onClick={() => goDrop(d)}>{d}</button>
                ))}
              </div>
            </>
          )}

          <div className="mob-links mono">
            <Link to="/about">ABOUT US</Link>
            <Link to="/cart">CART ({count})</Link>
            <Link to={accountLink} className="mob-admin">
              <IconUser width="13" height="13" /> {user ? accountLabel.toUpperCase() : 'LOG IN / SIGN UP'}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
