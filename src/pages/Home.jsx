import { useEffect, useMemo, useState } from 'react'
import { useLive } from '../lib/liveSite.js'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchHeroSlides, slidesFor, PHONE_QUERY } from '../lib/hero.js'
import { fetchTicker, fetchTickerSpeed, TICKER_SPEEDS, fetchHeroExtras, fetchHeroVideo, DEFAULT_HERO_BUTTON } from '../lib/siteSettings.js'
import DropCountdown from '../components/DropCountdown.jsx'
import PromoBanners from '../components/PromoBanners.jsx'
import { imgUrl } from '../lib/images.js'
import usePageMeta from '../lib/usePageMeta.js'
import './home.css'

const SLIDE_MS = 5000

export default function Home() {
  const [allSlides, setAllSlides] = useState([])
  const [active, setActive] = useState(0)
  // Phones and bigger screens each get their own hero photos (Admin →
  // Homepage → "For: PC / Mobile"); follows a resize or rotation too.
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY)
    const onChange = () => setIsPhone(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const slides = useMemo(() => slidesFor(allSlides, isPhone), [allSlides, isPhone])
  useEffect(() => { setActive(0) }, [isPhone])
  // Admin → Homepage → Ticker. Empty until loaded, so the old lines never
  // flash up before a sale announcement.
  const [ticker, setTicker] = useState(null)
  const [tickerSpeed, setTickerSpeed] = useState(null)
  // Admin → Homepage: the hero's button and the drop countdown.
  const [button, setButton] = useState(DEFAULT_HERO_BUTTON)
  const [countdown, setCountdown] = useState(null)
  // Admin → Homepage → Hero video: plays in place of the photos when set.
  const [heroVideo, setHeroVideo] = useState({ pc: null, mobile: null })
  const [calm] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  usePageMeta()
  // Ticks when the admin changes something: the effects below re-read.
  const live = useLive()

  // Hero slides live in the database so a new drop is an upload in the admin
  // panel, not a code change and redeploy.
  useEffect(() => {
    let cancelled = false
    fetchHeroSlides().then(({ slides }) => {
      if (cancelled) return
      setAllSlides(slides)
      setActive(0)
    })
    Promise.all([fetchTicker(), fetchTickerSpeed()]).then(([lines, speed]) => {
      if (cancelled) return
      setTickerSpeed(speed)
      setTicker(lines)
    })
    fetchHeroVideo().then(({ video }) => { if (!cancelled) setHeroVideo(video) })
    fetchHeroExtras().then(({ button, countdown }) => {
      if (cancelled) return
      setButton(button)
      setCountdown(countdown)
    })
    return () => { cancelled = true }
  }, [live])

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
        {/* The hero video, this screen's own or else the other's; never for
            visitors who've asked for less motion. The photos stay under it
            as its poster while it loads. */}
        {(() => {
          const v = isPhone ? heroVideo.mobile || heroVideo.pc : heroVideo.pc || heroVideo.mobile
          if (!v || calm) return null
          return (
            <video
              key={v.url}
              className="hero-img hero-video on"
              src={v.url}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              poster={slides[0] ? imgUrl(slides[0].image_url, { w: 1800 }) : undefined}
              aria-hidden="true"
            />
          )
        })()}
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

        <div className="hero-center">
          <DropCountdown countdown={countdown} />
          {/^https?:\/\//.test(button.link) ? (
            <a href={button.link} className="view-shop mono" target="_blank" rel="noreferrer">{button.label}</a>
          ) : (
            <Link to={button.link || '/shop'} className="view-shop mono">{button.label}</Link>
          )}
        </div>

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
        <div
          className={`ticker-track ${ticker ? 'run' : ''}`}
          key={ticker ? ticker.join('|') : 'empty'}
          style={tickerSpeed ? { '--tk-dur': `${TICKER_SPEEDS[tickerSpeed - 1]}s` } : undefined}
        >
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

      {/* Website → Banners: coming drops, sales, coupon boxes. */}
      <PromoBanners place="home" className="pb-home" />

      <Footer />
    </>
  )
}
