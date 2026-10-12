import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import ShimmerImage from '../components/ShimmerImage.jsx'
import { fetchLooks } from '../lib/lookbook.js'
import { fetchProducts } from '../lib/products.js'
import { imgUrl } from '../lib/images.js'
import usePageMeta from '../lib/usePageMeta.js'
import './lookbook.css'

// A drop's lookbook: every photo in a grid, four to a row on a computer and
// two on a phone. Tapping (or hovering) a photo names the pieces in it, and
// each name opens that product's page. Only the photos uploaded in Admin →
// Lookbook show here — product photos stay in the shop.
export default function Lookbook() {
  const { drop } = useParams()
  const [looks, setLooks] = useState(null)
  const [openId, setOpenId] = useState(null)
  // When a finger last went down — the click that follows a touch shouldn't
  // undo what the touch just opened.
  const touchedAt = useRef(0)

  usePageMeta(drop ? `${drop} — Lookbook` : 'Lookbook', drop ? `The ${drop} lookbook from PAUSE.` : undefined)

  useEffect(() => {
    let cancelled = false
    setLooks(null)
    setOpenId(null)

    Promise.all([fetchLooks(drop), fetchProducts()]).then(([{ looks: rows }, { products }]) => {
      if (cancelled) return
      const byId = Object.fromEntries(products.map((p) => [String(p.id), p]))

      const built = rows.map((l) => ({
        id: `l${l.id}`,
        image: l.image_url,
        focus: l.focus,
        title: l.title,
        // The name typed in Admin → Lookbook, else the product's own.
        items: (l.product_ids || [])
          .filter((id) => byId[id])
          .map((id) => ({ product: byId[id], label: l.item_labels?.[id]?.trim() || '' })),
      }))

      setLooks(built)
    })

    return () => { cancelled = true }
  }, [drop])

  return (
    <>
      <Nav />

      <div className="lb-page">
        <div className="lb-head">
          {/* The drop's name in ink, then "LOOKBOOK" the same size in pale grey. */}
          <h1 className="display">
            <span className="lb-drop">{drop}</span> <span className="lb-word">LOOKBOOK</span>
          </h1>
        </div>

        {looks === null && (
          <div className="lb-grid">
            {Array.from({ length: 8 }, (_, i) => <div className="lb-look lb-ghost shimmer" key={i} />)}
          </div>
        )}

        {looks?.length === 0 && <p className="lb-msg mono">The lookbook for this drop is coming soon.</p>}

        {looks?.length > 0 && (
          <div className="lb-grid">
            {looks.map((look) => {
              const open = openId === look.id
              const hasInfo = look.title || look.items.length > 0
              return (
                <figure
                  key={look.id}
                  className={`lb-look ${open ? 'open' : ''}`}
                  // A finger shows the names the moment it lands, not after
                  // the tap completes; a mouse click still toggles them.
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse' || !hasInfo) return
                    touchedAt.current = Date.now()
                    setOpenId(look.id)
                  }}
                  onClick={() => {
                    if (!hasInfo || Date.now() - touchedAt.current < 800) return
                    setOpenId(open ? null : look.id)
                  }}
                >
                  <ShimmerImage
                    src={imgUrl(look.image, { w: 900 })}
                    alt={look.title || look.items.map((it) => it.label || it.product.name).join(', ') || drop}
                    style={{ objectPosition: look.focus || 'center' }}
                    loading="lazy"
                  />

                  {hasInfo && (
                    <figcaption className="lb-info" onClick={(e) => e.stopPropagation()}>
                      {look.title && <div className="lb-title">{look.title}</div>}
                      {look.items.map(({ product: p, label }) => (
                        <Link to={`/product/${p.id}`} className="lb-item" key={p.id}>
                          <span>{label || `${p.name}${p.variant ? ` — ${p.variant}` : ''}`}</span>
                          <span className="lb-arrow" aria-hidden="true">→</span>
                        </Link>
                      ))}
                    </figcaption>
                  )}
                </figure>
              )
            })}
          </div>
        )}
      </div>

      <Footer />
    </>
  )
}
