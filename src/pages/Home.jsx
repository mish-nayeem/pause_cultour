import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchProducts } from '../lib/products.js'
import { cld } from '../lib/cloudinary.js'
import './home.css'

// Lookbook entries shown stacked on the hero. The active one is bright, the
// others fade out — the same "you are here in the reel" idea as the scrubber.
const LOOKBOOK = [
  { label: 'AUTUMN 26 RANGE', image: 'https://picsum.photos/seed/pausehero1/1800/1200' },
  { label: 'AUTUMN 26 LOOKBOOK', image: 'https://picsum.photos/seed/pausehero2/1800/1200' },
  { label: 'PAUSE DHANMONDI', image: 'https://picsum.photos/seed/pausehero3/1800/1200' },
  { label: 'PAUSE GULSHAN', image: 'https://picsum.photos/seed/pausehero4/1800/1200' },
]

export default function Home() {
  const [active, setActive] = useState(1)
  const [featured, setFeatured] = useState(null)

  // Only the featured product is needed here — the full grid lives on /shop.
  useEffect(() => {
    let cancelled = false
    fetchProducts().then(({ products }) => {
      if (cancelled) return
      setFeatured(products.find((p) => p.featured) || products[0] || null)
    })
    return () => { cancelled = true }
  }, [])

  const hero = LOOKBOOK[active]

  return (
    <>
      <section className="hero-full">
        <Nav overlay />

        {/* Every frame stays mounted and cross-fades, so switching lookbooks
            doesn't flash a blank gap while the next image downloads. */}
        {LOOKBOOK.map((item, i) => (
          <img
            key={item.label}
            src={cld(item.image, { w: 1800 })}
            alt=""
            className={`hero-img ${i === active ? 'on' : ''}`}
          />
        ))}

        <div className="hero-shade" />

        <div className="frame-badge mono">
          <span className="dot" /> FRAME 00482 / PAUSED
        </div>

        <div className="lookbook">
          {LOOKBOOK.map((item, i) => (
            <button
              key={item.label}
              className={`lb-item display ${i === active ? 'on' : ''}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <Link to="/shop" className="view-shop mono">VIEW SHOP</Link>

        <div className="hero-foot">
          <div className="scrub-track">
            <div
              className="scrub-fill"
              style={{ width: `${((active + 1) / LOOKBOOK.length) * 100}%` }}
            />
          </div>
          <div className="scrub-meta mono">
            <span>{hero.label}</span>
            <span>
              {String(active + 1).padStart(2, '0')} / {String(LOOKBOOK.length).padStart(2, '0')}
            </span>
          </div>
        </div>
      </section>

      {featured && (
        <section className="feature-strip">
          <Link to={`/product/${featured.id}`} className="feature-inner">
            <div className="feature-media">
              <img src={cld(featured.images[0], { w: 900 })} alt={featured.name} />
            </div>
            <div className="feature-copy">
              <div className="label mono">NOW PLAYING</div>
              <h2 className="display">{featured.name}</h2>
              <div className="feature-price mono">৳ {featured.price.toLocaleString()}</div>
              <p>{featured.description}</p>
              <span className="feature-cta mono">VIEW PRODUCT →</span>
            </div>
          </Link>
        </section>
      )}

      <Footer />
    </>
  )
}
