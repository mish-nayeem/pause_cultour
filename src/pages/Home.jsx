import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchHeroSlides } from '../lib/hero.js'
import { fetchTicker } from '../lib/siteSettings.js'
import { imgUrl } from '../lib/images.js'
import usePageMeta from '../lib/usePageMeta.js'
import './home.css'

const SLIDE_MS = 5000

export default function Home() {
  const [slides, setSlides] = useState([])
  const [active, setActive] = useState(0)
  // Admin → Homepage → Ticker. Empty until loaded, so the old lines never
  // flash up before a sale announcement.
  const [ticker, setTicker] = useState(null)

  usePageMeta()

  // Hero slides live in the database so a new drop is an upload in the admin
  // panel, not a code change and redeploy.
  useEffect(() => {
    let cancelled = false
    fetchHeroSlides().then(({ slides }) => {
      if (cancelled) return
      setSlides(slides)
      setActive(0)
    })
    fetchTicker().then((lines) => {
      if (!cancelled) setTicker(lines)
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

  return (
    <>
      <section className="hero-full">
        <Nav overlay />

        {/* Every frame stays mounted and cross-fades, so switching slides
            doesn't flash a blank gap while the next image downloads.
            objectPosition: the hero always fills the screen, so a photo whose
            shape differs from the viewport gets cropped — this keeps the part
            the admin chose in frame instead of trimming from the edges. */}
        {slides.map((item, i) => (
          <img
            key={item.id}
            src={imgUrl(item.image_url, { w: 1800 })}
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

      {/* Two identical halves; the track slides left by exactly one half, so
          the loop restarts on an identical frame with no visible jump. */}
      <div className="ticker" aria-hidden="true">
        {/* Keyed on the lines and only set moving once they've loaded: some
            phones work out the slide distance (-50% of the track) once, when
            the animation starts, so starting it on the empty placeholder
            left the strip standing still. */}
        <div className={`ticker-track ${ticker ? 'run' : ''}`} key={ticker ? ticker.join('|') : 'empty'}>
          {[0, 1].map((half) => (
            <div className="ticker-half" key={half}>
              {/* Repeated so even one short line fills a wide screen. */}
              {!ticker && <span className="ticker-item">{'\u00a0'}</span>}
              {ticker && Array.from({ length: Math.max(2, Math.ceil(8 / ticker.length)) }, () => ticker).flat().map((line, i) => (
                <span className="ticker-item" key={i}>
                  {line}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <Footer />
    </>
  )
}
