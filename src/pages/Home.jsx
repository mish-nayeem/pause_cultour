import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { fetchProducts } from '../lib/products.js'
import { cld } from '../lib/cloudinary.js'
import './home.css'

export default function Home() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let active = true
    fetchProducts().then(({ products, error }) => {
      if (!active) return
      setProducts(products)
      setLoadError(Boolean(error))
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  const featured = products.find((p) => p.featured)
  const rest = products.filter((p) => !p.featured)

  return (
    <>
      <Nav />

      <section className="hero">
        <img src="https://picsum.photos/seed/pausehero/1600/1200" alt="" />
        <div className="frame-badge mono"><span className="dot"></span> FRAME 00482 / PAUSED</div>
        <div className="play-static">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 4L20 12L6 20V4Z" fill="#EDEAE1" fillOpacity="0.9" />
          </svg>
        </div>
        <div className="hero-copy">
          <div className="eyebrow mono">AUTUMN 26 — NOW PAUSED ON DROP 02</div>
          <h1 className="display">Everything<br />on hold.</h1>
        </div>
        <div className="scrubber">
          <div className="scrub-track"><div className="scrub-fill"></div></div>
          <div className="scrub-meta">
            <div className="timecode mono">00:47 / 03:12</div>
            <div className="drops mono">
              <span>DROP 01</span>
              <span className="active">DROP 02</span>
              <span>DROP 03</span>
              <span>DROP 04</span>
            </div>
          </div>
        </div>
      </section>

      <div className="section-head">
        <div>
          <div className="label mono">NOW PLAYING</div>
          <h2 className="display">Shop Drop 02</h2>
        </div>
        <a href="#" className="view-all mono">VIEW ALL →</a>
      </div>

      {loading && <p className="mono" style={{ padding: '40px' }}>Loading catalog…</p>}

      {!loading && loadError && (
        <p className="mono" style={{ padding: '40px' }}>
          Couldn't load products right now. Check your Supabase connection and refresh.
        </p>
      )}

      {!loading && !loadError && products.length === 0 && (
        <p className="mono" style={{ padding: '40px' }}>
          No products yet — add some from the Supabase Table Editor.
        </p>
      )}

      {!loading && !loadError && products.length > 0 && (
        <div className="grid">
          {featured && (
            <Link to={`/product/${featured.id}`} className="card featured">
              <div className="thumb">
                <img src={cld(featured.images[0], { w: 900 })} alt={featured.name} />
                {featured.isNew && <div className="new-tag mono"><span className="rec"></span>NEW</div>}
                <div className="duration-tag mono">৳ {featured.price.toLocaleString()}</div>
                <div className="sku-tag mono">{featured.sku}</div>
              </div>
              <div className="card-info">
                <div className="name">{featured.name}</div>
                <div className="price mono">{featured.variant}</div>
              </div>
            </Link>
          )}

          {rest.map((p) => (
            <Link to={`/product/${p.id}`} className="card" key={p.id}>
              <div className="thumb">
                <img src={cld(p.images[0], { w: 500 })} alt={p.name} />
                {p.isNew && <div className="new-tag mono"><span className="rec"></span>NEW</div>}
                <div className="duration-tag mono">৳ {p.price.toLocaleString()}</div>
                <div className="sku-tag mono">{p.sku}</div>
              </div>
              <div className="card-info">
                <div className="name">{p.name}</div>
                <div className="price mono">{p.variant}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <footer>
        <div>
          <div className="flogo display">PAUSE</div>
          <div className="fnote mono" style={{ marginTop: '10px' }}>DHAKA, BD · EST. 2026</div>
        </div>
        <div className="fnote mono">RUNTIME 03:12 · ALL DROPS ARCHIVED BELOW</div>
      </footer>
    </>
  )
}
