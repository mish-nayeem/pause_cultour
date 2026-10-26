import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { fetchMenuCategories, fetchMenuDrops } from '../lib/navCategories.js'
import { IconUser, IconSearch, IconBag } from './Icons.jsx'
import SearchBar from './SearchBar.jsx'
import { lookbookPath } from '../lib/lookbook.js'
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
  // SHOP's "Shop by collection" second row (the drops, as shop filters).
  const [byCollection, setByCollection] = useState(false)
  // Mobile panel: false, 'shop' (SHOP — the shop's categories and
  // collections) or 'menu' (MENU — everything else).
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Scrolling down tucks the nav away; the slightest scroll back up brings
  // it back. Never while one of its menus is open, or near the top.
  const [tucked, setTucked] = useState(false)
  const [categories, setCategories] = useState([])
  const [drops, setDrops] = useState([])

  const [user, setUser] = useState(null)

  const closeTimer = useRef(null)
  const [leaving, setLeaving] = useState(false)

  // Closing on a delay rather than the instant the pointer leaves: the trip
  // from a nav link down to the panel clips the corner of the gap between them,
  // and without this grace period the menu shuts halfway there.
  function showMenu(name) {
    clearTimeout(closeTimer.current)
    setLeaving(false)
    if (name) setSearchOpen(false)
    if (name !== openMenu) setByCollection(false)
    setOpenMenu(name)
  }

  // …then it fades and lifts away (`leaving`) before it's gone, instead of
  // vanishing in one frame.
  function scheduleClose() {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      setLeaving(true)
      closeTimer.current = setTimeout(() => { setOpenMenu(null); setLeaving(false) }, 170)
    }, 220)
  }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const busy = Boolean(openMenu || menuOpen || searchOpen)
  useEffect(() => {
    if (overlay) return
    let last = window.scrollY
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const y = window.scrollY
        if (busy || y < 90) {
          setTucked(false)
          last = y
          return
        }
        if (y - last > 8) { setTucked(true); last = y }
        else if (last - y > 8) { setTucked(false); last = y }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll) }
  }, [overlay, busy])
  useEffect(() => { if (busy) setTucked(false) }, [busy])

  useEffect(() => watchUser(setUser), [])

  // The person icon leads to wherever this visitor belongs: the admin panel
  // for the owner, their account for a customer, the login page for a guest.
  const accountLink = !user ? '/login' : isAdminEmail(user.email) ? '/admin' : '/account'
  // Never says "Admin panel" — the icon's hover text is the same for everyone.
  const accountLabel = !user ? 'Log in / Sign up' : 'My account'

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
    setByCollection(false)
    setSearchOpen(false)
  }, [location.pathname, location.search])

  // A tap anywhere outside the open mobile panel (and outside the nav pill,
  // whose SHOP / MENU buttons toggle it themselves) closes it. That tap only
  // closes — it doesn't also press whatever was under it on the page.
  const panelRef = useRef(null)
  const headerRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e) {
      if (panelRef.current?.contains(e.target) || headerRef.current?.contains(e.target)) return
      setMenuOpen(false)
      // Swallow the click this tap makes on the page — but never one on the
      // nav pill, so SHOP / MENU answer straight away afterwards.
      const swallow = (ev) => {
        window.removeEventListener('click', swallow, { capture: true })
        if (headerRef.current?.contains(ev.target)) return
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

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

  // DROPS opens a drop's lookbook; SHOP → Shop by collection opens the same
  // drop as a normal shop grid with prices.
  function goLookbook(drop) {
    navigate(lookbookPath(drop))
  }

  function goDrop(drop) {
    navigate(`/shop?d=${encodeURIComponent(drop)}`)
  }

  // Which nav link is the page you're on — shown in blue.
  const path = location.pathname
  const here = path.startsWith('/lookbook')
    ? 'drops'
    : path.startsWith('/shop') || path.startsWith('/product')
      ? 'shop'
      : path === '/about'
        ? 'about'
        : path === '/cart' || path === '/checkout'
          ? 'cart'
          : path === '/login' || path === '/account' || path === '/admin'
            ? 'account'
            : ''
  const cls = (name, extra = '') => `${extra} ${here === name ? 'here' : ''}`.trim()

  const catList = ['ALL', 'NEW', ...categories]
  const openList = openMenu === 'drops' ? drops : catList
  const openGo = openMenu === 'drops' ? goLookbook : goCategory

  return (
    <div
      className={`nav-wrap ${overlay ? 'overlay' : ''} ${showBack ? 'has-back' : ''} ${tucked ? 'tucked' : ''}`}
      onMouseLeave={scheduleClose}
    >
      {showBack && (
        <button type="button" className="back-btn" onClick={goBack} aria-label="Go back">
          <span className="back-arrow" aria-hidden="true" />
          <span className="back-text">BACK</span>
        </button>
      )}

      <header className="site-header" ref={headerRef}>
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
              <Link to="/shop" className={cls('shop', openMenu === 'shop' ? 'dim' : '')}>SHOP</Link>
            </li>
            <li onMouseEnter={() => showMenu(drops.length > 0 ? 'drops' : null)}>
              <Link to="/shop" className={cls('drops', openMenu === 'drops' ? 'dim' : '')}>DROPS</Link>
            </li>
            <li onMouseEnter={() => showMenu(null)}><Link to="/about" className={cls('about')}>ABOUT US</Link></li>
            <li onMouseEnter={() => showMenu(null)}>
              <button type="button" className="search-btn" onClick={() => { setOpenMenu(null); setSearchOpen((v) => !v) }} aria-label="Search" title="Search">
                <IconSearch width="15" height="15" />
              </button>
            </li>
            <li onMouseEnter={() => showMenu(null)}>
              <Link to="/cart" className={cls('cart', 'cart')} data-cart-target>CART ({count})</Link>
            </li>
            <li onMouseEnter={() => showMenu(null)}>
              <Link to={accountLink} className={cls('account', 'admin-link')} title={accountLabel} aria-label={accountLabel}>
                <IconUser width="15" height="15" />
              </Link>
            </li>
          </ul>
        </nav>

        {/* Phones: SHOP opens the shop's categories and collections; MENU
            has the rest (the cart is the bag beside them). Whichever is open
            turns blue and a second tap shuts it; so does a tap outside the
            panel. */}
        <div className="mob-right">
          <button
            type="button"
            className="search-btn mob-search-btn"
            onClick={() => { setMenuOpen(false); setSearchOpen((v) => !v) }}
            aria-label="Search"
            aria-expanded={searchOpen}
          >
            <IconSearch width="17" height="17" />
          </button>
          <button
            type="button"
            className={`menu-btn ${here === 'shop' || menuOpen === 'shop' ? 'here' : ''}`}
            onClick={() => { setSearchOpen(false); setMenuOpen((v) => (v === 'shop' ? false : 'shop')) }}
            aria-expanded={menuOpen === 'shop'}
          >
            SHOP
          </button>
          <button
            type="button"
            className={`menu-btn ${menuOpen === 'menu' ? 'here' : ''}`}
            onClick={() => { setSearchOpen(false); setMenuOpen((v) => (v === 'menu' ? false : 'menu')) }}
            aria-expanded={menuOpen === 'menu'}
          >
            MENU
          </button>
          {/* The cart as a bag, the same size as the search glass, with a
              count once something is in it — on every page; it's the only
              cart button on a phone. */}
          <Link
            to="/cart"
            className={`search-btn mob-bag ${here === 'cart' ? 'here' : ''}`}
            data-cart-target
            onClick={() => { setMenuOpen(false); setSearchOpen(false) }}
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
          >
            <IconBag width="17" height="17" />
            {count > 0 && <span className="mob-bag-count mono">{count}</span>}
          </Link>
        </div>
      </header>

      {searchOpen && <SearchBar onClose={() => setSearchOpen(false)} />}

      {/* Desktop hover dropdown — same panel for both menus, so moving between
          SHOP and DROPS swaps the contents instead of stacking two boxes. */}
      {openMenu && openList.length > 0 && (
        <div className={`cat-menu ${leaving ? 'leaving' : ''}`} onMouseEnter={() => showMenu(openMenu)}>
          <div className="cat-inner mono">
            {openList.map((c) => (
              <button key={c} onClick={() => openGo(c)} onMouseEnter={() => setByCollection(false)}>{c}</button>
            ))}
            {openMenu === 'shop' && drops.length > 0 && (
              <button
                className={`cat-sub-toggle ${byCollection ? 'on' : ''}`}
                onMouseEnter={() => setByCollection(true)}
                onClick={() => setByCollection((v) => !v)}
                aria-expanded={byCollection}
              >
                SHOP BY COLLECTION ›
              </button>
            )}
          </div>

          {openMenu === 'shop' && byCollection && (
            <div className="cat-inner cat-sub mono">
              {drops.map((d) => (
                <button key={d} onClick={() => goDrop(d)}>{d}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mobile panel */}
      {menuOpen && (
        <div className="mob-panel" ref={panelRef} data-lenis-prevent>
          {menuOpen === 'shop' && (
            <>
              <div className="mob-section mono">SHOP</div>
              <div className="mob-cats mono">
                {catList.map((c) => (
                  <button key={c} onClick={() => goCategory(c)}>{c}</button>
                ))}
              </div>

              {drops.length > 0 && (
                <>
                  <div className="mob-section mono">SHOP BY COLLECTION</div>
                  <div className="mob-cats mono">
                    {drops.map((d) => (
                      <button key={d} onClick={() => goDrop(d)}>{d}</button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {menuOpen === 'menu' && (
          <>
          {drops.length > 0 && (
            <>
              <div className="mob-section mono">DROPS · LOOKBOOK</div>
              <div className="mob-cats mono">
                {drops.map((d) => (
                  <button key={d} onClick={() => goLookbook(d)}>{d}</button>
                ))}
              </div>
            </>
          )}

          <div className="mob-links mono">
            <Link to="/about">ABOUT US</Link>
            <Link to={accountLink} className="mob-admin">
              <IconUser width="13" height="13" /> {user ? 'MY ACCOUNT' : 'LOG IN / SIGN UP'}
            </Link>
          </div>
          </>
          )}
        </div>
      )}
    </div>
  )
}
