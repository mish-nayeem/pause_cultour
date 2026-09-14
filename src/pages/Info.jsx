import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { INFO_PAGES } from '../content/info-pages.js'
import './info.css'

export default function Info({ slug }) {
  const page = INFO_PAGES[slug]

  // These pages are usually reached from the footer, which means the visitor is
  // already scrolled to the bottom when they click.
  useEffect(() => { window.scrollTo(0, 0) }, [slug])

  if (!page) {
    return (
      <>
        <Nav />
        <div className="info-page">
          <p className="mono">That page doesn't exist.</p>
          <Link to="/" className="back-link mono">← BACK HOME</Link>
        </div>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Nav />

      <div className="info-page">
        <div className="info-head">
          <div className="label mono">{page.eyebrow}</div>
          <h1 className="display">{page.title}</h1>
          <p className="info-intro">{page.intro}</p>
        </div>

        {page.blocks.map((block, i) => {
          if (block.type === 'contact') {
            return (
              <div className="info-contact" key={i}>
                {block.items.map((item) => (
                  <a className="ct-card" href={item.href} key={item.label}>
                    <div className="ct-label mono">{item.label}</div>
                    <div className="ct-value">{item.value}</div>
                  </a>
                ))}
              </div>
            )
          }

          if (block.type === 'table') {
            return (
              <section className="info-block" key={i}>
                <h2 className="display">{block.heading}</h2>
                <div className="info-table-wrap">
                  <table className="info-table">
                    <thead>
                      <tr>
                        {block.head.map((h) => (
                          <th className="mono" key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, ci) => (
                            <td className={ci === 0 ? 'mono first' : 'mono'} key={ci}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          }

          return (
            <section className="info-block" key={i}>
              <h2 className="display">{block.heading}</h2>
              <p>{block.body}</p>
            </section>
          )
        })}

        <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
      </div>

      <Footer />
    </>
  )
}
