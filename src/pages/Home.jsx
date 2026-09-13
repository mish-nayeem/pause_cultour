import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchProducts } from '../lib/products.js'
import { fetchHeroSlides } from '../lib/hero.js'
import { cld } from '../lib/cloudinary.js'
import './home.css'

const SLIDE_MS = 5000

export default function Home() {
  const [slides, setSlides] = useState([])
  const [active, setActive] = useState(0)
  const [featured, setFeatured] = useState(null)

  // Hero slides live in the database so a new drop is an upload in the admin
  // panel, not a code change and redeploy.
  useEffect(() => {
    let cancelled = false
    fetchHeroSlides().then(({ slides }) => {
      if (cancelled) return
      setSlides(slides)
      setActive(0)
    })
    return () => { cancelled = true }
  }, [])

  // Auto-advance. Skipped entirely for a single slide so we don't run a timer
  // that can never change anything.
  useEffect(() => {
    if (slides.length < 2) return
    const timer = setInterval(() => {
      setActive((i) => (i + 1) % slides.length)
    }, SLIDE_MS)
    return () => clearInterval(timer)
  }, [slides.length])

  // Only the featured product is needed here — the full grid lives on /shop.
  useEffect(() => {
    let cancelled = false
    fetchProducts().then(({ products }) => {
      if (cancelled) return
      setFeatured(products.find((p) => p.featured) || products[0] || null)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <section className="hero-full">
        <Nav overlay />

        {/* Every frame stays mounted and cross-fades, so switching slides
            doesn't flash a blank gap while the next image downloads. */}
        {slides.map((item, i) => (
          // objectPosition: the hero always fills the screen, so a photo whose
          // shape differs from the viewport gets cropped. This keeps the part
          // the admin chose in frame instead of always trimming from the edges.
          <img
            key={item.id}
            src={cld(item.image_url, { w: 1800 })}
            alt=""
            className={`hero-img ${i === active ? 'on' : ''}`}
            style={{ objectPosition: item.focus || 'center' }}
          />
        ))}

        <div className="hero-shade" />

        <Link to="/shop" className="view-shop mono">VIEW SHOP</Link>

        {slides.length > 1 && (
          <div className="hero-dots">
            {slides.map((s, i) => (
              <button
                key={s.id}
                className={i === active ? 'on' : ''}
                onClick={() => setActive(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        )}
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
