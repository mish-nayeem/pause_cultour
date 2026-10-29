import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import ReturnPortal from '../components/ReturnPortal.jsx'
import { AboutBody } from './About.jsx'
import { INFO_PAGES, SUPPORT_TABS, OWN_PAGES } from '../content/info-pages.js'
import { fetchSupportPages, fetchSupportTabs } from '../lib/support.js'
import { useLive } from '../lib/liveSite.js'
import usePageMeta from '../lib/usePageMeta.js'
import './info.css'
import './support.css'
import './about.css'

// /support/<tab> — the support pages behind one tab row (Return & Refund,
// Exchange, Delivery, Contact, About us, and any the admin adds), each set
// up in Admin → Support → Support pages. Privacy policy, Terms of service
// and the Return & Exchange Portal are pages of their own at /support/<slug>
// without the row. The old addresses (/refunds, /delivery, …) redirect here.
export default function Support() {
  const { slug: asked } = useParams()
  // Built-in copy straight away, the admin's edits as soon as they load.
  const [pages, setPages] = useState(INFO_PAGES)
  const [tabs, setTabs] = useState(() => SUPPORT_TABS.map((t) => ({ ...t, on: true })))
  const [ready, setReady] = useState(false)
  const tabsRef = useRef(null)
  const live = useLive()

  useEffect(() => {
    let alive = true
    Promise.all([fetchSupportPages(), fetchSupportTabs()]).then(([{ pages }, { tabs }]) => {
      if (!alive) return
      setPages(pages)
      setTabs(tabs)
      setReady(true)
    })
    return () => { alive = false }
  }, [live])

  const row = tabs.filter((t) => t.on !== false)
  const slug = asked || row[0]?.slug || 'refunds'
  const own = OWN_PAGES.find((t) => t.slug === slug)
  const tab = tabs.find((t) => t.slug === slug)

  // On a phone the row scrolls sideways — keep the open tab in view.
  useEffect(() => {
    const on = tabsRef.current?.querySelector('a.on')
    if (on) tabsRef.current.scrollTo({ left: on.offsetLeft - 20, behavior: 'smooth' })
  }, [slug])

  const page = slug === 'portal' || slug === 'about' ? null : pages[slug]
  usePageMeta(own?.label || tab?.label || page?.title || 'Support', page?.intro)

  // An address with nothing behind it (a tab since deleted) goes to the
  // first tab — once the admin's tabs are in, so a new tab isn't bounced.
  if (ready && !own && !page && slug !== 'about') return <Navigate to="/support" replace />

  return (
    <>
      <Nav />

      <div className="support-page">
        {!own && (
          <div className="support-tabs-wrap">
            <nav className="support-tabs mono" aria-label="Support" ref={tabsRef}>
              {row.map((t) => (
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
        )}

        {slug === 'portal' ? (
          <ReturnPortal />
        ) : slug === 'about' ? (
          <AboutBody />
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
