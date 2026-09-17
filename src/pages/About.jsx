import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { fetchAboutBlocks } from '../lib/about.js'
import { cld } from '../lib/cloudinary.js'
import usePageMeta from '../lib/usePageMeta.js'
import './about.css'

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
        <div className="about-head">
          <div className="label mono">PAUSE</div>
          <h1 className="display">About us</h1>
        </div>

        {loading && <p className="about-msg mono">Loading…</p>}

        {!loading && blocks.length === 0 && (
          <p className="about-msg mono">This story is still being written.</p>
        )}

        {blocks.map((b) => (
          <section className="about-block" key={b.id}>
            <div className="about-shot">
              <img src={cld(b.image_url, { w: 1400 })} alt="" loading="lazy" />
            </div>
            {b.description && <p className="about-text">{b.description}</p>}
          </section>
        ))}

        <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
      </div>

      <Footer />
    </>
  )
}
