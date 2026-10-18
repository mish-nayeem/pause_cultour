import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import ReturnPortal from '../components/ReturnPortal.jsx'
import { INFO_PAGES, SUPPORT_TABS } from '../content/info-pages.js'
import { fetchSupportPages } from '../lib/support.js'
import usePageMeta from '../lib/usePageMeta.js'
import './info.css'
import './support.css'

// /support/<tab> — every policy page and the Return & Exchange Portal behind
// one tab row. The old addresses (/refunds, /delivery, …) redirect here.
export default function Support() {
  const { slug = 'refunds' } = useParams()
  const tab = SUPPORT_TABS.find((t) => t.slug === slug)
  // Built-in copy straight away, the admin's edits as soon as they load.
  const [pages, setPages] = useState(INFO_PAGES)
  const tabsRef = useRef(null)

  useEffect(() => {
    let alive = true
    fetchSupportPages().then(({ pages }) => alive && setPages(pages))
    return () => { alive = false }
  }, [])

  // On a phone the row scrolls sideways — keep the open tab in view.
  useEffect(() => {
    const on = tabsRef.current?.querySelector('a.on')
    if (on) tabsRef.current.scrollTo({ left: on.offsetLeft - 20, behavior: 'smooth' })
  }, [slug])

  const page = slug === 'portal' ? null : pages[slug]
  usePageMeta(tab?.label || 'Support', page?.intro)

  if (!tab) return <Navigate to="/support" replace />

  return (
    <>
      <Nav />

      <div className="support-page">
        <div className="support-tabs-wrap">
          <nav className="support-tabs mono" aria-label="Support" ref={tabsRef}>
            {SUPPORT_TABS.map((t) => (
              <Link
                key={t.slug}
                to={`/support/${t.slug}`}
                className={t.slug === slug ? 'on' : ''}
                aria-current={t.slug === slug ? 'page' : undefined}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        {slug === 'portal' ? (
          <ReturnPortal />
        ) : (
          page && <InfoBody page={page} />
        )}
      </div>

      <Footer />
    </>
  )
}

export function InfoBody({ page }) {
  return (
    <div className="info-page">
      <div className="info-head">
        <div className="label mono">{page.eyebrow || 'SUPPORT'}</div>
        <h1 className="display">{page.title}</h1>
        {page.intro && <p className="info-intro">{page.intro}</p>}
      </div>

      {page.blocks.map((block, i) => {
        if (block.type === 'contact') {
          return (
            <div className="info-contact" key={i}>
              {(block.items || []).map((item, ii) => (
                <a className="ct-card" href={item.href || undefined} key={ii}>
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
              {block.heading && <h2 className="display">{block.heading}</h2>}
              <div className="info-table-wrap">
                <table className="info-table">
                  <thead>
                    <tr>
                      {(block.head || []).map((h, hi) => (
                        <th className="mono" key={hi}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(block.rows || []).map((row, ri) => (
                      <tr key={ri}>
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
            {block.heading && <h2 className="display">{block.heading}</h2>}
            <p>{block.body}</p>
          </section>
        )
      })}

      <Link to="/shop" className="back-link mono">← BACK TO SHOP</Link>
    </div>
  )
}
