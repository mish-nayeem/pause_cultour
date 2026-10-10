import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchProducts } from '../lib/products.js'
import { CardPrice, SaleBadge } from '../components/SalePrice.jsx'
import { fetchMenuCategories } from '../lib/navCategories.js'
import { imgUrl } from '../lib/images.js'
import { isAllSoldOut, isSoldOut } from '../lib/stock.js'
import usePageMeta from '../lib/usePageMeta.js'
import Pager from '../components/Pager.jsx'
import ShimmerImage from '../components/ShimmerImage.jsx'
import ShopFilter, { sortSizes } from '../components/ShopFilter.jsx'
import QuickAdd from '../components/QuickAdd.jsx'
import { scrollToTarget } from '../lib/smoothScroll.js'
import './shop.css'

const PAGE_SIZE = 24

export default function Shop() {
  const [params, setParams] = useSearchParams()
  const activeDrop = params.get('d') || ''
  const active = params.get('c') || 'ALL'
  // The FILTER panel's two choices live in the address too (?so=hide&s=M),
  // so Back and a shared link keep them.
  const hideSoldOut = params.get('so') === 'hide'
  const sizeFilter = params.get('s') || ''
  usePageMeta(activeDrop || (active === 'ALL' ? 'Shop' : active))

  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchProducts().then(({ products, error }) => {
      if (cancelled) return
      setProducts(products)
      setLoadError(Boolean(error))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // Same list the nav dropdown shows, so a category pulled from the menu in
  // the admin panel disappears from these filters too.
  useEffect(() => {
    let cancelled = false
    fetchMenuCategories().then((found) => {
      if (!cancelled) setCategories(found)
    })
    return () => { cancelled = true }
  }, [])

  // A drop is its own view of the catalog, so it replaces the category filter
  // rather than narrowing it — arriving from the DROPS menu shows that drop
  // whole, not the part of it that happens to match the last category picked.
  const inView = useMemo(() => {
    if (activeDrop) return products.filter((p) => p.drop === activeDrop)
    if (active === 'ALL') return products
    if (active === 'NEW') return products.filter((p) => p.isNew)
    return products.filter((p) => p.category === active)
  }, [products, active, activeDrop])

  // Every size anything in this view comes in — the panel never offers one
  // that would empty the grid by definition.
  const sizeOptions = useMemo(
    () => sortSizes([...new Set(inView.flatMap((p) => p.sizes || []))]),
    [inView]
  )

  // A size picked: products cut in that size. With sold-out hidden as well,
  // only the ones that still have that size to buy.
  const shown = useMemo(
    () =>
      inView.filter((p) => {
        if (sizeFilter) {
          if (!(p.sizes || []).includes(sizeFilter)) return false
          if (hideSoldOut && isSoldOut(p, sizeFilter)) return false
          return true
        }
        return !(hideSoldOut && isAllSoldOut(p))
      }),
    [inView, sizeFilter, hideSoldOut]
  )

  // The page lives in the address (?p=2) so Back returns to it and a page can
  // be shared. Picking a different category or drop drops it, starting over at 1.
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, Number(params.get('p')) || 1), totalPages)
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Category buttons start a fresh view but keep whatever the FILTER panel
  // is set to — switching from hoodies to tees shouldn't forget "size M".
  function pick(c) {
    const next = new URLSearchParams()
    if (c !== 'ALL') next.set('c', c)
    if (hideSoldOut) next.set('so', 'hide')
    if (sizeFilter) next.set('s', sizeFilter)
    setParams(next)
  }

  function applyFilter({ hideSoldOut: hide, size }) {
    const next = new URLSearchParams(params)
    next.delete('p')
    if (hide) next.set('so', 'hide')
    else next.delete('so')
    if (size) next.set('s', size)
    else next.delete('s')
    setParams(next, { replace: true })
  }

  function goToPage(n) {
    const next = new URLSearchParams(params)
    if (n <= 1) next.delete('p')
    else next.set('p', String(n))
    setParams(next)
    scrollToTarget(0)
  }

  return (
    <>
      <Nav />

      <div className="shop-head">
        <div>
          <div className="label mono">{activeDrop ? 'DROP' : 'SHOP'}</div>
          <h1 className="display">
            {activeDrop || (active === 'ALL' ? 'Everything' : active)}
          </h1>
        </div>
      </div>

      <div className="filters mono">
        <button
          className={active === 'ALL' && !activeDrop ? 'on' : ''}
          onClick={() => pick('ALL')}
        >
          ALL
        </button>
        <button
          className={active === 'NEW' && !activeDrop ? 'on' : ''}
          onClick={() => pick('NEW')}
        >
          NEW
        </button>
        {categories.map((c) => (
          <button
            key={c}
            className={active === c && !activeDrop ? 'on' : ''}
            onClick={() => pick(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Card-shaped placeholders in the real grid, so the page already has
          its shape while the catalog loads and nothing jumps when it lands. */}
      {loading && (
        <div className="shop-grid" role="status" aria-label="Loading catalog">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="scard skel" key={i} aria-hidden="true">
              <div className="sthumb shimmer" />
              <div className="sinfo">
                <span className="skel-line shimmer" style={{ width: '62%', marginBottom: '10px' }} />
                <span className="skel-line shimmer" style={{ width: '38%' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && loadError && (
        <p className="shop-msg mono">
          Couldn't load products right now. Check your connection and refresh.
        </p>
      )}

      {!loading && !loadError && shown.length === 0 && (
        <p className="shop-msg mono">
          {inView.length > 0 ? (
            <>
              Nothing matches this filter.{' '}
              <button className="shop-clear mono" onClick={() => applyFilter({ hideSoldOut: false, size: '' })}>
                Clear filter
              </button>
            </>
          ) : (
            'Nothing in this category yet.'
          )}
        </p>
      )}

      {!loading && !loadError && shown.length > 0 && (
        <div className="shop-grid">
          {pageItems.map((p) => (
            // Sold out, the card opens the product with its "email me when
            // it's back" box already open (?notify=1).
            <Link
              to={`/product/${p.id}${isAllSoldOut(p) ? '?notify=1' : ''}`}
              className="scard"
              key={p.id}
            >
              <div className="sthumb">
                <ShimmerImage src={imgUrl(p.images[0], { w: 500 })} alt={p.name} />
                {p.isNew && <span className="snew mono"><i className="rec" />NEW</span>}
                <SaleBadge product={p} />
                <QuickAdd product={p} />
              </div>
              <div className="sinfo">
                {/* Said in words above the price rather than as a sheet over
                    the photo — the piece is still worth looking at, and it can
                    still go on a wishlist. */}
                {isAllSoldOut(p) && <div className="sout mono">SOLD OUT</div>}
                <div className="sname">{p.name}</div>
                <div className="smeta mono">
                  <span>{p.variant}</span>
                  <CardPrice product={p} />
                </div>
                {isAllSoldOut(p) && <span className="card-notify mono">NOTIFY ME</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && !loadError && <Pager page={page} totalPages={totalPages} onChange={goToPage} />}

      {!loading && !loadError && inView.length > 0 && (
        <ShopFilter sizes={sizeOptions} hideSoldOut={hideSoldOut} size={sizeFilter} onChange={applyFilter} />
      )}

      <Footer />
    </>
  )
}
