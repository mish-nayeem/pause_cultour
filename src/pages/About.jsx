import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchAboutBlocks } from '../lib/about.js'
import { imgUrl } from '../lib/images.js'
import usePageMeta from '../lib/usePageMeta.js'
import './about.css'

// An empty line in the admin text starts a new paragraph.
function paragraphs(text) {
  return (text || '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)
}

export default function About() {
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)

  usePageMeta('About us', 'The people and the process behind PAUSE.')

  useEffect(() => {
    let cancelled = false
    fetchAboutBlocks().then(({ blocks }) => {
      if (cancelled) return
      setBlocks(blocks)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <Nav />

      <div className="about-page">
        {/* The @pause.cultour mark from the footer stands in for a page title. */}
        <div className="about-head">
          <h1>
            <img src="/footer-handle.png" alt="@pause.cultour — About us" width="668" height="128" />
          </h1>
        </div>

        {loading && <p className="about-msg mono">Loading…</p>}

        {!loading && blocks.length === 0 && (
          <p className="about-msg mono">This story is still being written.</p>
        )}

        {/* Photo on the left, heading and text on the right; stacked on a phone. */}
        {blocks.map((b) => (
          <section className="about-block" key={b.id}>
            <div className="about-shot">
              <img src={imgUrl(b.image_url, { w: 1400 })} alt={b.heading || ''} loading="lazy" />
            </div>
            {(b.heading || b.description) && (
              <div className="about-copy">
                {b.heading && <h2 className="about-heading">{b.heading}</h2>}
                {paragraphs(b.description).map((t, i) => (
                  <p className="about-text" key={i}>{t}</p>
                ))}
              </div>
            )}
          </section>
        ))}

        <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
      </div>

      <Footer />
    </>
  )
}
