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
} from '../lib/lookbook.js'
import { IconX } from './Icons.jsx'
import './about-manager.css'
import './lookbook-manager.css'

// Admin → Lookbook. One lookbook per drop: upload photos, give each an
// optional caption, tag the products worn in it (those names show on the
// photo and link to the product), reorder, hide or delete.
export default function LookbookManager({ products }) {
  const [looks, setLooks] = useState([])
  const [menuDrops, setMenuDrops] = useState([])
  const [drop, setDrop] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [confirmId, setConfirmId] = useState(null)

  async function load() {
    const { looks, error } = await fetchAllLooks()
    if (error) setError("Couldn't load the lookbook — has supabase-migration-lookbook.sql been run?")
    setLooks(looks)
    setLoading(false)
  }

  useEffect(() => {
    load()
    fetchMenuDrops().then(setMenuDrops)
  }, [])

  // Every drop name the shop knows about: the DROPS menu, the products' own
  // drops, and any lookbook already made.
  const drops = useMemo(() => {
    const names = [
      ...menuDrops,
      ...products.map((p) => p.drop_name),
      ...looks.map((l) => l.drop_name),
    ].filter(Boolean)
    return [...new Set(names)]
  }, [menuDrops, products, looks])

  useEffect(() => {
    if (!drop && drops.length) setDrop(drops[0])
  }, [drops, drop])

  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products])
  const inDrop = products.filter((p) => p.drop_name === drop)
  const others = products.filter((p) => p.drop_name !== drop)
  const shown = looks.filter((l) => l.drop_name === drop)

  function label(p) {
    return `${p.name}${p.variant ? ` — ${p.variant}` : ''}`
  }

  async function handleUpload(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
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
    setLooks((prev) => [...prev.filter((l) => l.drop_name !== drop), ...ordered])
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

  return (
    <section className="panel">
      <div className="panel-note mono" style={{ marginBottom: '18px' }}>
        Each drop has its own lookbook page — the DROPS menu opens it. Upload the
        drop's photos here, then tag the products in each photo: on the site,
        tapping a photo shows those product names and each one opens its page.
        A drop with no photos here shows its products' own pictures instead.
      </div>

      {error && <div className="err-banner mono">{error}</div>}

      {drops.length === 0 && !loading && (
        <div className="empty mono">No drops yet — give a product a drop name first (Products → edit → Drop).</div>
      )}

      {drops.length > 0 && (
        <>
          <div className="lk-drops">
            {drops.map((d) => (
              <button
                key={d}
                type="button"
                className={`lk-drop mono ${d === drop ? 'on' : ''}`}
                onClick={() => { setDrop(d); setConfirmId(null) }}
              >
                {d}
                <span className="lk-count">{looks.filter((l) => l.drop_name === d).length}</span>
              </button>
            ))}
          </div>

          <div className="lk-bar">
            <a href={lookbookPath(drop)} target="_blank" rel="noreferrer" className="lk-view mono">
              View {drop} lookbook ↗
            </a>
          </div>

          <div className="am-add">
            <input
              className="am-text-input lk-title-input"
              placeholder="Caption (optional) — e.g. Jorts and waffle crop top"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <label className={`am-upload mono ${busy ? 'busy' : ''}`}>
              {busy ? 'Working…' : '+ Upload photos'}
              <input type="file" accept="image/*" multiple onChange={handleUpload} disabled={busy} />
            </label>
          </div>

          <div className="am-size-note mono">
            <strong>Photos:</strong> portrait shots (4:5, e.g. 1600 × 2000 px) fill the
            two-a-row grid best. You can pick several at once.
            <br />
            <strong>Names:</strong> tag each product in the photo, then type the name
            to show for it (e.g. "Jorts"). Leave it empty to use the product's own name.
            The name opens that product's page.
          </div>

          {loading && <div className="empty mono">Loading…</div>}

          {!loading && shown.length === 0 && (
            <div className="empty mono">
              No photos in the {drop} lookbook yet — until you add some, it shows the
              drop's product pictures.
            </div>
          )}

          <div className="am-list">
            {shown.map((l, i) => (
              <div className={`am-row lk-row ${l.active ? '' : 'off'}`} key={l.id}>
                <div className="am-thumb lk-thumb">
                  <img src={imgUrl(l.image_url, { w: 320 })} alt="" />
                </div>

                <div className="lk-body">
                  <input
                    className="am-text lk-title"
                    defaultValue={l.title || ''}
                    placeholder="Caption (optional)"
                    onBlur={(e) => saveTitle(l, e.target.value)}
                  />

                  <div className="lk-label mono">PRODUCTS IN THIS PHOTO — NAME SHOWN ON THE PHOTO</div>
                  <div className="lk-items">
                    {l.product_ids.map((id) => (
                      <div className="lk-item" key={id}>
                        <input
                          className="lk-name"
                          defaultValue={l.item_labels?.[id] || ''}
                          placeholder={byId[id] ? label(byId[id]) : 'Name on the photo'}
                          maxLength={60}
                          onBlur={(e) => saveLabel(l, id, e.target.value)}
                        />
                        <span className="lk-link mono">
                          → {byId[id] ? label(byId[id]) : `${id} (deleted)`}
                        </span>
                        <button type="button" onClick={() => removeProduct(l, id)} aria-label="Remove product">×</button>
                      </div>
                    ))}
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
                </div>

                <div className="am-side">
                  <div className="am-order mono">
                    <button onClick={() => move(i, -1)} disabled={i === 0 || busy}>←</button>
                    <span>{i + 1}</span>
                    <button onClick={() => move(i, 1)} disabled={i === shown.length - 1 || busy}>→</button>
                  </div>

                  <button className="am-toggle mono" onClick={() => patch(l, { active: !l.active })} disabled={busy}>
                    {l.active ? 'Visible' : 'Hidden'}
                  </button>

                  {confirmId === l.id ? (
                    <div className="am-confirm mono">
                      <button className="am-danger" onClick={() => remove(l.id)}>Delete</button>
                      <button className="am-ghost" onClick={() => setConfirmId(null)}>No</button>
                    </div>
                  ) : (
                    <button className="am-x mono" onClick={() => setConfirmId(l.id)} title="Delete photo">
                      <IconX width="13" height="13" /> Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
