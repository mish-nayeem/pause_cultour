import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import ShimmerImage from '../components/ShimmerImage.jsx'
import { fetchLooks } from '../lib/lookbook.js'
import { fetchProducts } from '../lib/products.js'
import { imgUrl } from '../lib/images.js'
import usePageMeta from '../lib/usePageMeta.js'
import './lookbook.css'

// A drop's lookbook: big photos, two to a row. Tapping (or hovering) a photo
// names the pieces in it, and each name opens that product's page. Looks come
// from Admin → Lookbook; a drop without any shows its products' own photos.
export default function Lookbook() {
  const { drop } = useParams()
  const [looks, setLooks] = useState(null)
  const [openId, setOpenId] = useState(null)

  usePageMeta(drop ? `${drop} — Lookbook` : 'Lookbook', drop ? `The ${drop} lookbook from PAUSE.` : undefined)

  useEffect(() => {
    let cancelled = false
    setLooks(null)
    setOpenId(null)

    Promise.all([fetchLooks(drop), fetchProducts()]).then(([{ looks: rows }, { products }]) => {
      if (cancelled) return
      const byId = Object.fromEntries(products.map((p) => [String(p.id), p]))

      const built = rows.length
        ? rows.map((l) => ({
            id: `l${l.id}`,
            image: l.image_url,
            focus: l.focus,
            title: l.title,
            items: (l.product_ids || []).map((id) => byId[id]).filter(Boolean),
          }))
        : products
            .filter((p) => p.drop === drop && p.images.length > 0)
            .map((p) => ({ id: `p${p.id}`, image: p.images[0], title: '', items: [p] }))

      setLooks(built)
    })

    return () => { cancelled = true }
  }, [drop])

  return (
    <>
      <Nav />

      <div className="lb-page">
        <div className="lb-head">
          <div className="label mono">LOOKBOOK</div>
          <h1 className="display">{drop}</h1>
          <Link to={`/shop?d=${encodeURIComponent(drop)}`} className="lb-shop mono">SHOP THIS DROP →</Link>
        </div>

        {looks === null && (
          <div className="lb-grid">
            {[0, 1, 2, 3].map((i) => <div className="lb-look lb-ghost shimmer" key={i} />)}
          </div>
        )}

        {looks?.length === 0 && <p className="lb-msg mono">Nothing in this lookbook yet.</p>}

        {looks?.length > 0 && (
          <div className="lb-grid">
            {looks.map((look) => {
              const open = openId === look.id
              const hasInfo = look.title || look.items.length > 0
              return (
                <figure
                  key={look.id}
                  className={`lb-look ${open ? 'open' : ''}`}
                  onClick={() => hasInfo && setOpenId(open ? null : look.id)}
                >
                  <ShimmerImage
                    src={imgUrl(look.image, { w: 1000 })}
                    alt={look.title || look.items.map((p) => p.name).join(', ') || drop}
                    style={{ objectPosition: look.focus || 'center' }}
                    loading="lazy"
                  />

                  {hasInfo && (
                    <figcaption className="lb-info" onClick={(e) => e.stopPropagation()}>
                      {look.title && <div className="lb-title">{look.title}</div>}
                      {look.items.map((p) => (
                        <Link to={`/product/${p.id}`} className="lb-item" key={p.id}>
                          <span>{p.name}{p.variant ? ` — ${p.variant}` : ''}</span>
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
