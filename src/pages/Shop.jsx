import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchProducts } from '../lib/products.js'
import { fetchMenuCategories } from '../lib/navCategories.js'
import { cld } from '../lib/cloudinary.js'
import usePageMeta from '../lib/usePageMeta.js'
import './shop.css'

export default function Shop() {
  const [params, setParams] = useSearchParams()
  const activeDrop = params.get('d') || ''
  const active = params.get('c') || 'ALL'
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
  const shown = useMemo(() => {
    if (activeDrop) return products.filter((p) => p.drop === activeDrop)
    if (active === 'ALL') return products
    if (active === 'NEW') return products.filter((p) => p.isNew)
    return products.filter((p) => p.category === active)
  }, [products, active, activeDrop])

  function pick(c) {
    if (c === 'ALL') setParams({})
    else setParams({ c })
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
        <div className="shop-count mono">
          {shown.length} {shown.length === 1 ? 'piece' : 'pieces'}
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

      {loading && <p className="shop-msg mono">Loading catalog…</p>}

      {!loading && loadError && (
        <p className="shop-msg mono">
          Couldn't load products right now. Check your connection and refresh.
        </p>
      )}

      {!loading && !loadError && shown.length === 0 && (
        <p className="shop-msg mono">Nothing in this category yet.</p>
      )}

      {!loading && !loadError && shown.length > 0 && (
        <div className="shop-grid">
          {shown.map((p) => (
            <Link to={`/product/${p.id}`} className="scard" key={p.id}>
              <div className="sthumb">
                <img src={cld(p.images[0], { w: 500 })} alt={p.name} />
                {p.isNew && <span className="snew mono"><i className="rec" />NEW</span>}
                {p.sizesOut.length > 0 && p.sizes.length === 0 && (
                  <span className="sout mono">SOLD OUT</span>
                )}
              </div>
              <div className="sinfo">
                <div className="sname">{p.name}</div>
                <div className="smeta mono">
                  <span>{p.variant}</span>
                  <span>৳ {p.price.toLocaleString()}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Footer />
    </>
  )
}
