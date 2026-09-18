import { useEffect, useMemo, useState } from 'react'
import { IconLink } from './Icons.jsx'
import { fetchAllNavCategories, SHOP_MENU, DROPS_MENU } from '../lib/navCategories.js'
import './link-generator.css'

// Fixed list, not a free-text field — a typo here ("Reel" vs "reel" vs
// "REEL") would otherwise split one source into separate rows on the
// Overview tab's attribution panel. Each source carries its own utm_medium,
// so whoever builds the link never has to think about medium at all. One
// entry per platform + placement, since a reel and a story on the same
// platform get pasted into different spots (caption vs. link sticker) and
// are worth telling apart in the numbers.
const SOURCES = [
  { value: 'insta_bio', label: 'Instagram bio', medium: 'bio', group: 'Instagram' },
  { value: 'insta_post', label: 'Instagram post', medium: 'social', group: 'Instagram' },
  { value: 'insta_reel', label: 'Instagram reel', medium: 'social', group: 'Instagram' },
  { value: 'insta_story', label: 'Instagram story', medium: 'social', group: 'Instagram' },
  { value: 'fb_post', label: 'Facebook post', medium: 'social', group: 'Facebook' },
  { value: 'fb_reel', label: 'Facebook reel', medium: 'social', group: 'Facebook' },
  { value: 'fb_story', label: 'Facebook story', medium: 'social', group: 'Facebook' },
]

// The product name goes in before this ever reaches the customer, so they
// never have to identify or type it themselves — just their own details and
// the size. That also means whatever comes back names an exact catalog
// product instead of a guess, which is what the "New order" form's
// screenshot/message extraction matches against.
function dmTemplate(product) {
  return `Hi! To confirm your order for ${product.name} — ${product.variant}, please reply with:

Name:
Phone number:
Full address (house/road/area):
District:
Size:
Quantity:

Thanks — PAUSE`
}

export default function LinkGenerator({ products }) {
  const [destination, setDestination] = useState('home')
  const [source, setSource] = useState('insta_reel')
  const [copied, setCopied] = useState(false)
  const [templateCopied, setTemplateCopied] = useState(false)

  // A drop or a category is its own view of the shop (see Shop.jsx's ?d= and
  // ?c= filters), so each gets its own destination instead of forcing a link
  // to one product out of the group. Read straight from the Nav menus tab's
  // own table rather than off the products list, so a category added there
  // shows up here right away, and one that's hidden or deleted drops out —
  // without that, this list and the one a customer actually sees could drift
  // apart.
  const [drops, setDrops] = useState([])
  const [categories, setCategories] = useState([])

  useEffect(() => {
    let cancelled = false

    async function load(menu, productField, setList) {
      const { categories: rows } = await fetchAllNavCategories(menu)
      const list = rows.length > 0
        ? rows.filter((r) => r.active).map((r) => r.label)
        : [...new Set(products.map((p) => p[productField]).filter(Boolean))].sort()
      if (!cancelled) setList(list)
    }

    load(DROPS_MENU, 'drop_name', setDrops)
    load(SHOP_MENU, 'category', setCategories)

    return () => { cancelled = true }
  }, [products])

  const path = useMemo(() => {
    if (destination === 'home') return '/'
    if (destination === 'shop') return '/shop'
    if (destination.startsWith('drop:')) return `/shop?d=${encodeURIComponent(destination.slice(5))}`
    if (destination.startsWith('cat:')) return `/shop?c=${encodeURIComponent(destination.slice(4))}`
    return `/product/${destination}`
  }, [destination])

  const link = useMemo(() => {
    const chosen = SOURCES.find((s) => s.value === source) || SOURCES[0]
    const url = new URL(path, window.location.origin)
    url.searchParams.set('utm_source', chosen.value)
    url.searchParams.set('utm_medium', chosen.medium)
    return url.toString()
  }, [path, source])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be blocked; the link is on screen to select by hand.
    }
  }

  const selectedProduct = products.find((p) => String(p.id) === destination) || null

  async function copyTemplate() {
    if (!selectedProduct) return
    try {
      await navigator.clipboard.writeText(dmTemplate(selectedProduct))
      setTemplateCopied(true)
      setTimeout(() => setTemplateCopied(false), 2000)
    } catch {
      // Clipboard access can be blocked; nothing more to fall back to here.
    }
  }

  return (
    <section className="panel">
      <div className="panel-label mono" style={{ marginBottom: '6px' }}>
        <IconLink width="13" height="13" />TRACKED LINK
      </div>
      <div className="panel-note" style={{ marginBottom: '18px' }}>
        Pick where it's pointing and where it's going out — the link comes out
        tagged, and every order placed through it shows up under that source on
        the Overview tab.
      </div>

      <div className="linkgen-row">
        <label className="linkgen-field">
          <span className="mono">DESTINATION</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="home">Homepage</option>
            <option value="shop">Shop page</option>
            {drops.length > 0 && (
              <optgroup label="Drops">
                {drops.map((d) => (
                  <option key={`drop:${d}`} value={`drop:${d}`}>{d}</option>
                ))}
              </optgroup>
            )}
            {categories.length > 0 && (
              <optgroup label="Categories">
                {categories.map((c) => (
                  <option key={`cat:${c}`} value={`cat:${c}`}>{c}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Products">
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.variant ? ` — ${p.variant}` : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="linkgen-field">
          <span className="mono">SOURCE</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <optgroup label="Instagram">
              {SOURCES.filter((s) => s.group === 'Instagram').map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </optgroup>
            <optgroup label="Facebook">
              {SOURCES.filter((s) => s.group === 'Facebook').map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      <div className="linkgen-output">
        <span className="linkgen-url mono">{link}</span>
        <button type="button" className="linkgen-copy mono" onClick={copyLink}>
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </div>

      {selectedProduct && (
        <div className="linkgen-template">
          <div className="linkgen-template-head mono">
            <span>DM TEMPLATE — {selectedProduct.name} — {selectedProduct.variant}</span>
            <button type="button" className="linkgen-copy mono" onClick={copyTemplate}>
              {templateCopied ? 'COPIED' : 'COPY'}
            </button>
          </div>
          <pre className="linkgen-template-text mono">{dmTemplate(selectedProduct)}</pre>
        </div>
      )}
    </section>
  )
}
