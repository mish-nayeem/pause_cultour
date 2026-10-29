import { useEffect, useMemo, useState } from 'react'
import useDraft from '../lib/useDraft.js'
import DraftNote from './DraftNote.jsx'
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'
import PromoBanners from './PromoBanners.jsx'
import { saveSetting } from '../lib/siteSettings.js'
import { fetchCoupons, describeCoupon } from '../lib/coupons.js'
import { listSales } from '../lib/sales.js'
import { launchLabel } from '../lib/schedule.js'
import { dropKey } from '../lib/lookbook.js'
import {
  BOX_COLORS, PLACES, colorOf, promoCards,
  fetchBoxes, fetchPlaces, fetchDropBanners, clearPromoCache,
} from '../lib/promos.js'
import './promo-manager.css'

const KINDS = [
  { key: 'soon', label: 'New drop coming', tip: 'A collection with a launch time ahead and "coming soon" ticked (Products → Collections → open it). Shows a countdown; goes away at launch.' },
  { key: 'sale', label: 'Sale', tip: 'Every running sale from Marketing → Sales, by itself — on a drop it shows the drop\'s banner photo, on chosen products the first product\'s photo. Goes away when the sale ends.' },
  { key: 'coupon', label: 'Coupon boxes', tip: 'The five boxes below — the ones with a code written in.' },
]

// Website → Banners. Where the promo banners show, and the five coupon
// boxes. Sales and coming drops make their own banners; this page only
// decides where they appear.
export default function PromoManager({ products }) {
  const [boxes, setBoxes] = useState(null)
  const [places, setPlaces] = useState(null)
  const [saved, setSaved] = useState('')
  const [banners, setBanners] = useState({})
  const [sales, setSales] = useState([])
  const [coupons, setCoupons] = useState([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState('home')

  useEffect(() => {
    Promise.all([fetchBoxes(), fetchPlaces(), fetchDropBanners(), listSales(), fetchCoupons()]).then(([b, p, d, s, c]) => {
      setBoxes(b.boxes)
      setPlaces(p.places)
      setSaved(JSON.stringify([b.boxes, p.places]))
      setBanners(d.banners)
      setSales(s.sales)
      setCoupons(c.coupons)
      if (b.error) setNote("Couldn't load — has supabase-migration-site-settings.sql been run?")
    })
  }, [])

  const drops = useMemo(() => {
    const m = new Map()
    for (const p of products) if (p.drop_name) m.set(dropKey(p.drop_name), p.drop_name.trim())
    for (const b of Object.values(banners)) if (b?.name) m.set(dropKey(b.name), b.name)
    return [...m.values()].sort()
  }, [products, banners])

  const live = sales.filter((s) => s.active && new Date(s.ends_at).getTime() > Date.now())
  const coming = Object.values(banners).filter((b) => b?.launch_at && new Date(b.launch_at).getTime() > Date.now())

  // Unsaved boxes and places stay in this browser until Save.
  const kept = useDraft('promo', { boxes, places }, (v) => { setBoxes(v.boxes); setPlaces(v.places) }, { enabled: Boolean(boxes && places) })

  // The preview draws exactly what the shop would, from what's typed here.
  const previewData = useMemo(() => {
    if (!boxes || !places) return null
    const thumbs = Object.fromEntries(products.map((p) => [String(p.id), { id: p.id, name: p.name, images: p.images || [] }]))
    return { banners, boxes, places, sales: live, thumbs }
  }, [boxes, places, banners, live, products])

  if (!boxes || !places) return <div className="empty mono">Loading…</div>

  const dirty = JSON.stringify([boxes, places]) !== saved
  const setBox = (i, patch) => { setBoxes((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b))); setNote('') }
  const togglePlace = (kind, place) => {
    setPlaces((prev) => {
      const on = prev[kind].includes(place)
      return { ...prev, [kind]: on ? prev[kind].filter((x) => x !== place) : [...prev[kind], place] }
    })
    setNote('')
  }

  async function save() {
    const clean = boxes.map((b) => ({ ...b, code: String(b.code || '').trim().toUpperCase(), text: String(b.text || '').trim() }))
    setBusy(true)
    const [a, b] = await Promise.all([saveSetting('promo_boxes', clean), saveSetting('promo_places', places)])
    setBusy(false)
    if (a.error || b.error) return setNote("Couldn't save — has supabase-migration-site-settings.sql been run?")
    clearPromoCache()
    setBoxes(clean)
    setSaved(JSON.stringify([clean, places]))
    kept.saved({ boxes: clean, places })
    setNote('Saved — live on the website now.')
  }

  const known = new Set(coupons.filter((c) => c.active).map((c) => c.code))

  return (
    <div className="pm">
      <DraftNote draft={kept} />
      <AdminBox
        wide
        title="HOW BANNERS WORK"
        tip="Three kinds of banner, all from one place. Sales and coming drops make their own — nothing to type here. Coupon boxes are the only ones you write."
      >
        <ul className="pm-how">
          <li><b>New drop coming</b> — Products → Collections → open a collection → upload its banner image, set a launch time, keep “coming soon” ticked. A card with a countdown shows until launch.</li>
          <li><b>Sale</b> — Marketing → Sales → create a sale. Its card shows by itself while it runs: on a drop with the drop's banner photo, on chosen products with the product's photo, and a countdown to the end.</li>
          <li><b>Coupon</b> — write a code in one of the five boxes below, pick its colour, Save. Customers tap “Copy code” and paste it at checkout. Make the code itself in Marketing → Coupons first, or checkout won't take it.</li>
          <li>Each drop's banner image also shows wide on top of that drop's page in the shop.</li>
        </ul>
      </AdminBox>

      <AdminBox wide title="WHERE THEY SHOW" tip="Tick the pages each kind of banner appears on. Homepage: under the ticker. Shop: under the page title (a drop's page too). Cart: under the order summary, right before checkout.">
        <div className="pm-places">
          <div className="pm-places-row pm-places-head mono"><span />{PLACES.map((p) => <span key={p.key}>{p.label}</span>)}</div>
          {KINDS.map((k) => (
            <div className="pm-places-row" key={k.key}>
              <span className="pm-kind">{k.label} <InfoTip>{k.tip}</InfoTip></span>
              {PLACES.map((p) => (
                <label key={p.key} className="pm-tick">
                  <input type="checkbox" checked={places[k.key].includes(p.key)} onChange={() => togglePlace(k.key, p.key)} aria-label={`${k.label} on ${p.label}`} />
                </label>
              ))}
            </div>
          ))}
        </div>
      </AdminBox>

      <AdminBox
        wide
        title="COUPON BOXES"
        tip={
          <>
            <p>Five boxes, one colour each to start — change any box's colour by tapping a dot. Write a code and a line about it; an empty box doesn't show.</p>
            <p><b>Links to</b>: a drop shows the drop's banner photo small and opens the drop; a product shows its photo and opens it; nothing = just the code.</p>
            <p>The code is only text here — the discount itself comes from Marketing → Coupons, so make it there with the same code.</p>
          </>
        }
      >
        <div className="pm-boxes">
          {boxes.map((b, i) => {
            const c = colorOf(b.color)
            const code = String(b.code || '').trim().toUpperCase()
            return (
              <div className="pm-box" key={b.id} style={{ borderColor: c.bg }}>
                <div className="pm-box-head mono">
                  <span className="pm-box-num" style={{ background: c.bg, color: c.ink }}>BOX {i + 1}</span>
                  <div className="pm-dots">
                    {BOX_COLORS.map((x) => (
                      <button key={x.key} type="button" title={x.label} aria-label={x.label} className={`pm-dot ${b.color === x.key ? 'on' : ''}`} style={{ background: x.bg }} onClick={() => setBox(i, { color: x.key })} />
                    ))}
                  </div>
                  <label className="pm-on">
                    <input type="checkbox" checked={b.on} onChange={(e) => setBox(i, { on: e.target.checked })} /> Show
                  </label>
                </div>

                {coupons.length > 0 && (
                  <select className="ab-input" value="" onChange={(e) => {
                    const cp = coupons.find((x) => x.code === e.target.value)
                    if (cp) setBox(i, { code: cp.code, text: describeCoupon(cp) })
                  }}>
                    <option value="">Fill from a coupon…</option>
                    {coupons.map((cp) => <option key={cp.code} value={cp.code}>{cp.code} — {describeCoupon(cp)}{cp.active ? '' : ' (off)'}</option>)}
                  </select>
                )}
                <input className="ab-input pm-code" value={b.code} maxLength={24} onChange={(e) => setBox(i, { code: e.target.value.toUpperCase() })} placeholder="CODE, e.g. EID10" />
                <input className="ab-input" value={b.text} maxLength={80} onChange={(e) => setBox(i, { text: e.target.value })} placeholder="10% off everything · this week only" />

                <div className="pm-link">
                  <select className="ab-input" value={b.target} onChange={(e) => setBox(i, { target: e.target.value })}>
                    <option value="none">Links to: nothing</option>
                    <option value="drop">Links to: a drop</option>
                    <option value="product">Links to: a product</option>
                  </select>
                  {b.target === 'drop' && (
                    <select className="ab-input" value={b.drop} onChange={(e) => setBox(i, { drop: e.target.value })}>
                      <option value="">Pick a drop…</option>
                      {drops.map((d) => <option key={d} value={d}>{d}{banners[dropKey(d)]?.image ? '' : ' (no banner image)'}</option>)}
                    </select>
                  )}
                  {b.target === 'product' && (
                    <select className="ab-input" value={b.product_id} onChange={(e) => setBox(i, { product_id: e.target.value })}>
                      <option value="">Pick a product…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.variant ? ` · ${p.variant}` : ''}</option>)}
                    </select>
                  )}
                </div>
                {code && !known.has(code) && <div className="ab-warn mono">No active coupon “{code}” in Marketing → Coupons — checkout won't accept it.</div>}
              </div>
            )
          })}
        </div>
        <div className="ab-row" style={{ marginTop: 14 }}>
          <button type="button" className="ab-btn" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          {note && <span className="ab-note mono">{note}</span>}
        </div>
      </AdminBox>

      <AdminBox wide title="MADE BY THEMSELVES" tip="Read only — change these where they're made.">
        <div className="pm-auto">
          <div>
            <div className="ab-label mono">RUNNING SALES <span className="dim">(Marketing → Sales)</span></div>
            {live.length === 0 ? <div className="ab-empty mono">No sale running.</div> : live.map((s) => (
              <div className="pm-auto-row mono" key={s.id}>{s.name || 'Sale'} · {s.percent}% off · {s.drop_name ? s.drop_name : (s.product_ids?.length ? `${s.product_ids.length} products` : 'everything')} · ends {launchLabel(s.ends_at)}</div>
            ))}
          </div>
          <div>
            <div className="ab-label mono">COMING DROPS <span className="dim">(Products → Collections)</span></div>
            {coming.length === 0 ? <div className="ab-empty mono">No collection with a launch time ahead.</div> : coming.map((b) => (
              <div className="pm-auto-row mono" key={b.name}>{b.name} · {launchLabel(b.launch_at)} · {b.soon === false ? 'coming soon OFF' : 'announced'}{b.image ? '' : ' · no banner image'}</div>
            ))}
          </div>
        </div>
      </AdminBox>

      <AdminBox wide title="PREVIEW" tip="Exactly what that page will show, from what's on this page now — unsaved changes included.">
        <div className="chips mono" style={{ marginBottom: 12 }}>
          {PLACES.map((p) => <button key={p.key} type="button" className={`chip ${preview === p.key ? 'on' : ''}`} onClick={() => setPreview(p.key)}>{p.label.toUpperCase()}</button>)}
        </div>
        <div className={`pm-preview ${preview === 'cart' ? 'narrow' : ''}`}>
          <PromoBanners place={preview} data={previewData} className={preview === 'cart' ? 'pb-cart' : ''} />
          {promoCards(previewData, preview).length === 0 && <div className="ab-empty mono">Nothing shows here right now — no sale running, no coming drop, no coupon box ticked for this page.</div>}
        </div>
      </AdminBox>
    </div>
  )
}
