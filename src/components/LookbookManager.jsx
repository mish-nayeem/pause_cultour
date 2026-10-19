import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl, uploadImage } from '../lib/images.js'
import { fetchMenuDrops } from '../lib/navCategories.js'
import {
  fetchAllLooks,
  createLook,
  updateLook,
  deleteLook,
  reorderLooks,
  lookbookPath,
  dropKey,
} from '../lib/lookbook.js'
import { fetchSetting, saveSetting } from '../lib/siteSettings.js'
import InfoTip from './InfoTip.jsx'
import FocusPicker from './FocusPicker.jsx'
import { IconX } from './Icons.jsx'
import './lookbook-manager.css'

// Admin → Lookbook. One lookbook per drop, in boxes: pick the drop, see how
// complete it is (and which of its products aren't in any photo yet), add
// photos, a phone and PC preview of the page — then every photo as a card: what
// stays in frame, a caption, the products worn in it, order, hide, delete.
export default function LookbookManager({ products }) {
  const [looks, setLooks] = useState([])
  const [menuDrops, setMenuDrops] = useState([])
  const [drop, setDrop] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [heroLink, setHeroLink] = useState(null)
  const [heroNote, setHeroNote] = useState('')
  const [view, setView] = useState('phone')

  async function load() {
    const { looks, error } = await fetchAllLooks()
    if (error) setError("Couldn't load the lookbook — has supabase-migration-lookbook.sql been run?")
    setLooks(looks)
    setLoading(false)
  }

  useEffect(() => {
    load()
    fetchMenuDrops().then(setMenuDrops)
    fetchSetting('hero_button').then(({ value }) => setHeroLink(value?.link || '/shop'))
  }, [])

  // Every drop the shop knows about: the DROPS menu, the products' own drops,
  // and any lookbook already made — one per drop however it's spelt
  // (dropKey), named as the DROPS menu writes it.
  const drops = useMemo(() => {
    const names = [
      ...menuDrops,
      ...products.map((p) => p.drop_name),
      ...looks.map((l) => l.drop_name),
    ].filter((n) => n && n.trim())
    const seen = new Map()
    for (const n of names) if (!seen.has(dropKey(n))) seen.set(dropKey(n), n.trim())
    return [...seen.values()]
  }, [menuDrops, products, looks])

  useEffect(() => {
    if (!drop && drops.length) setDrop(drops[0])
  }, [drops, drop])

  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products])
  const same = (name) => dropKey(name) === dropKey(drop)
  const inDrop = products.filter((p) => same(p.drop_name))
  const others = products.filter((p) => !same(p.drop_name))
  const shown = looks.filter((l) => same(l.drop_name))
  const visible = shown.filter((l) => l.active)

  // The drop's products that no photo tags yet — worth a look before launch.
  const tagged = new Set(shown.flatMap((l) => l.product_ids))
  const missing = inDrop.filter((p) => !tagged.has(String(p.id)))
  const untagged = shown.filter((l) => l.product_ids.length === 0).length

  const heroHere = heroLink != null && heroLink.startsWith('/lookbook/') && dropKey(decodeURIComponent(heroLink.slice(10))) === dropKey(drop)

  function label(p) {
    return `${p.name}${p.variant ? ` — ${p.variant}` : ''}`
  }

  async function upload(files) {
    files = files.filter((f) => f.type.startsWith('image/'))
    if (!files.length || !drop) return

    setBusy(true)
    setError('')
    try {
      // Several photos can go up at once; each becomes its own look, in the
      // order picked, after the ones already there.
      let order = shown.length
      for (const file of files) {
        const url = await uploadImage(file, supabase, 'lookbook')
        const { error: createError } = await createLook({
          drop_name: drop,
          image_url: url,
          title: files.length === 1 ? newTitle.trim() : '',
          sort_order: order++,
        })
        if (createError) throw new Error('Could not save the photo')
      }
      setNewTitle('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function patch(look, change) {
    setLooks((prev) => prev.map((l) => (l.id === look.id ? { ...l, ...change } : l)))
    const { error } = await updateLook(look.id, change)
    if (error) {
      setError("Couldn't save that change — try again.")
      load()
    }
  }

  function saveTitle(look, title) {
    if (title.trim() === (look.title || '')) return
    patch(look, { title: title.trim() })
  }

  function addProduct(look, id) {
    if (!id || look.product_ids.includes(id)) return
    patch(look, { product_ids: [...look.product_ids, id] })
  }

  function removeProduct(look, id) {
    const labels = { ...(look.item_labels || {}) }
    delete labels[id]
    patch(look, { product_ids: look.product_ids.filter((x) => x !== id), item_labels: labels })
  }

  // The name shown on the photo for this product; empty → its own name.
  function saveLabel(look, id, text) {
    const labels = { ...(look.item_labels || {}) }
    const clean = text.trim()
    if ((labels[id] || '') === clean) return
    if (clean) labels[id] = clean
    else delete labels[id]
    patch(look, { item_labels: labels })
  }

  async function move(index, dir) {
    const target = index + dir
    if (target < 0 || target >= shown.length) return
    const next = [...shown]
    ;[next[index], next[target]] = [next[target], next[index]]
    const ordered = next.map((l, i) => ({ ...l, sort_order: i }))
    setLooks((prev) => [...prev.filter((l) => !same(l.drop_name)), ...ordered])
    setBusy(true)
    await reorderLooks(next)
    setBusy(false)
  }

  async function remove(id) {
    setBusy(true)
    await deleteLook(id)
    setConfirmId(null)
    await load()
    setBusy(false)
  }

  // Homepage → Hero button straight to this lookbook, for a fresh drop.
  async function pointHero() {
    const value = { label: `SHOP ${drop}`.toUpperCase().slice(0, 28), link: lookbookPath(drop) }
    const { error } = await saveSetting('hero_button', value)
    if (error) return setHeroNote("Couldn't save — try again.")
    setHeroLink(value.link)
    setHeroNote(`Homepage button now says ${value.label}.`)
  }

  return (
    <div className="lk">
      {error && <div className="err-banner mono">{error}</div>}

      {/* ---- Drops ---- */}
      <Box
        title="DROPS"
        wide
        tip="Every drop has its own lookbook page — the DROPS menu opens it. Pick a drop to work on its photos. A drop shows up here once a product has it as its Drop, or it's in the DROPS menu."
      >
        {drops.length === 0 && !loading && (
          <div className="empty mono">No drops yet — give a product a drop name first (Products → edit → Drop).</div>
        )}
        <div className="lk-drops">
          {drops.map((d) => {
            const mine = looks.filter((l) => dropKey(l.drop_name) === dropKey(d))
            const cover = mine.find((l) => l.active) || mine[0]
            return (
              <button
                key={d}
                type="button"
                className={`lk-drop ${dropKey(d) === dropKey(drop) ? 'on' : ''}`}
                onClick={() => { setDrop(d); setConfirmId(null); setHeroNote('') }}
              >
                <span className="lk-drop-cover">
                  {cover ? <img src={imgUrl(cover.image_url, { w: 160 })} alt="" style={{ objectPosition: cover.focus || 'center' }} /> : <i className="mono">NO PHOTOS</i>}
                </span>
                <span className="lk-drop-name">{d}</span>
                <span className="lk-drop-count mono">{mine.length} photo{mine.length === 1 ? '' : 's'}</span>
              </button>
            )
          })}
        </div>
      </Box>

      {drop && (
        <>
          {/* ---- This drop ---- */}
          <Box
            title={`${drop.toUpperCase()} AT A GLANCE`}
            tip="How complete this lookbook is. Products not in any photo yet can't be found from the lookbook — tag them in a photo below if they're worn in one."
          >
            <div className="lk-stats">
              <div><strong>{visible.length}</strong><span className="mono">SHOWING</span></div>
              <div><strong>{shown.length - visible.length}</strong><span className="mono">HIDDEN</span></div>
              <div className={untagged ? 'warn' : ''}><strong>{untagged}</strong><span className="mono">NO PRODUCTS</span></div>
            </div>

            <div className="lk-sub mono">
              NOT IN ANY PHOTO YET
              <InfoTip>Products with {drop} as their drop that no photo here tags. Each one is listed until a photo tags it.</InfoTip>
            </div>
            {inDrop.length === 0 ? (
              <div className="lk-none mono">No products have {drop} as their drop.</div>
            ) : missing.length === 0 ? (
              <div className="lk-ok mono">✓ Every {drop} product is in a photo.</div>
            ) : (
              <div className="lk-missing">
                {missing.map((p) => (
                  <span className="lk-chip" key={p.id} title={label(p)}>
                    {p.images?.[0] && <img src={imgUrl(p.images[0], { w: 80 })} alt="" />}
                    <span>{label(p)}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="lk-links">
              <a href={lookbookPath(drop)} target="_blank" rel="noreferrer" className="lk-view mono">Open the {drop} lookbook ↗</a>
              {heroLink != null && (heroHere ? (
                <span className="lk-ok mono">✓ The homepage button opens this lookbook</span>
              ) : (
                <span className="lk-hero">
                  <button type="button" className="courier-btn ghost mono" onClick={pointHero}>Point the homepage button here</button>
                  <InfoTip>Sets Homepage → Hero button to SHOP {drop.toUpperCase()}, opening this lookbook — handy while the drop is new. Change it back in Admin → Homepage.</InfoTip>
                </span>
              ))}
              {heroNote && <span className="lk-note mono">{heroNote}</span>}
            </div>
          </Box>

          {/* ---- Add photos ---- */}
          <Box
            title="ADD PHOTOS"
            tip={
              <>
                <p><b>Size:</b> portrait shots (4:5, e.g. 1600 × 2000 px) fill the grid best — 4 a row on a PC, 2 on a phone.</p>
                <p>Pick or drop several at once; they go in after the photos already there, in the order picked. The caption is used when you add a single photo.</p>
                <p>Only these photos show in the lookbook — product photos stay in the shop.</p>
              </>
            }
          >
            <label className="lk-field">
              <span className="lk-flabel mono">CAPTION (OPTIONAL)</span>
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Jorts and waffle crop top" maxLength={80} />
            </label>
            <label
              className={`lk-drop-zone mono ${busy ? 'busy' : ''} ${dragging ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) upload([...e.dataTransfer.files]) }}
            >
              <strong>{busy ? 'Uploading…' : '+ Choose photos'}</strong>
              <span>or drop them here · 4:5 portrait</span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={busy}
                onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; upload(f) }}
              />
            </label>
          </Box>

          {/* ---- Preview ---- */}
          <Box title="PREVIEW" tip="The lookbook page as it looks now — two photos a row on a phone, four on a PC — hidden ones left out, cropped as you set under each photo. Scroll inside the screen to see them all.">
            <div className="lk-view-pick mono" role="radiogroup" aria-label="Preview on">
              {[['phone', 'Phone'], ['pc', 'PC / laptop']].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
              ))}
            </div>
            <div className={`lk-screen-wrap ${view}`}>
              {/* data-lenis-prevent: the page's smooth scroll would take the wheel otherwise, and the screen wouldn't scroll. */}
              <div className="lk-screen" data-lenis-prevent>
                <div className="lk-screen-head">
                  <b>{drop}</b> <span>LOOKBOOK</span>
                </div>
                {visible.length === 0 ? (
                  <div className="lk-screen-empty mono">The lookbook for this drop is coming soon.</div>
                ) : (
                  <div className="lk-screen-grid">
                    {visible.map((l) => (
                      <img key={l.id} src={imgUrl(l.image_url, { w: 200 })} alt="" style={{ objectPosition: l.focus || 'center' }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Box>

          {/* ---- Photos ---- */}
          <Box
            title={`PHOTOS · ${drop.toUpperCase()}`}
            wide
            tip={
              <>
                <p>Each photo in the order the page shows it — ← → moves it.</p>
                <p><b>Products in this photo:</b> tag what's worn. On the site, tapping the photo lists them and each opens its product page. Type a short name to show instead of the product's own (e.g. "Jorts"), or leave it empty.</p>
                <p><b>Keep in frame:</b> which part stays when the grid crops a photo that isn't 4:5.</p>
              </>
            }
          >
            {loading && <div className="empty mono">Loading…</div>}
            {!loading && shown.length === 0 && (
              <div className="empty mono">No photos in the {drop} lookbook yet — the page says it's coming soon until you add some.</div>
            )}

            <div className="lk-grid">
              {shown.map((l, i) => (
                <div className={`lk-card ${l.active ? '' : 'off'}`} key={l.id}>
                  <div className="lk-shot">
                    <img src={imgUrl(l.image_url, { w: 480 })} alt="" style={{ objectPosition: l.focus || 'center' }} />
                    <span className="lk-pos mono">{i + 1}</span>
                    {!l.active && <span className="lk-hidden mono">HIDDEN</span>}
                  </div>

                  <FocusPicker value={l.focus} disabled={busy} onChange={(focus) => patch(l, { focus })} />

                  <input
                    className="lk-caption"
                    defaultValue={l.title || ''}
                    placeholder="Caption (optional)"
                    maxLength={80}
                    onBlur={(e) => saveTitle(l, e.target.value)}
                  />

                  <div className="lk-sub mono">PRODUCTS IN THIS PHOTO</div>
                  <div className="lk-items">
                    {l.product_ids.map((id) => {
                      const p = byId[id]
                      return (
                        <div className="lk-item" key={id}>
                          <span className="lk-item-thumb">{p?.images?.[0] && <img src={imgUrl(p.images[0], { w: 80 })} alt="" />}</span>
                          <span className="lk-item-body">
                            <input
                              className="lk-name"
                              defaultValue={l.item_labels?.[id] || ''}
                              placeholder={p ? label(p) : 'Name on the photo'}
                              maxLength={60}
                              aria-label="Name shown on the photo"
                              onBlur={(e) => saveLabel(l, id, e.target.value)}
                            />
                            <span className="lk-link mono">→ {p ? label(p) : `${id} (deleted)`}</span>
                          </span>
                          <button type="button" onClick={() => removeProduct(l, id)} aria-label="Remove product">×</button>
                        </div>
                      )
                    })}
                    {l.product_ids.length === 0 && <span className="lk-none mono">None tagged yet</span>}
                  </div>

                  <select className="lk-add" value="" onChange={(e) => addProduct(l, e.target.value)}>
                    <option value="">+ Tag a product…</option>
                    {inDrop.length > 0 && (
                      <optgroup label={`In ${drop}`}>
                        {inDrop.filter((p) => !l.product_ids.includes(String(p.id))).map((p) => (
                          <option key={p.id} value={String(p.id)}>{label(p)}</option>
                        ))}
                      </optgroup>
                    )}
                    {others.length > 0 && (
                      <optgroup label="Other products">
                        {others.filter((p) => !l.product_ids.includes(String(p.id))).map((p) => (
                          <option key={p.id} value={String(p.id)}>{label(p)}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  <div className="lk-card-row mono">
                    <span className="lk-move">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0 || busy} aria-label="Earlier">←</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === shown.length - 1 || busy} aria-label="Later">→</button>
                    </span>
                    <button type="button" className={`lk-vis ${l.active ? 'on' : ''}`} onClick={() => patch(l, { active: !l.active })} disabled={busy}>
                      {l.active ? 'Showing' : 'Hidden'}
                    </button>
                    {confirmId === l.id ? (
                      <span className="lk-confirm">
                        <button type="button" className="lk-danger" onClick={() => remove(l.id)}>Delete</button>
                        <button type="button" className="lk-ghost" onClick={() => setConfirmId(null)}>No</button>
                      </span>
                    ) : (
                      <button type="button" className="lk-x" onClick={() => setConfirmId(l.id)} aria-label="Delete photo"><IconX width="13" height="13" /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Box>
        </>
      )}
    </div>
  )
}

function Box({ title, tip, wide = false, children }) {
  return (
    <section className={`lk-box ${wide ? 'wide' : ''}`}>
      <div className="lk-box-head">
        <span className="lk-box-title mono">{title}</span>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      {children}
    </section>
  )
}
