import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl, uploadImage } from '../lib/images.js'
import { fetchDropBanners, saveDropBanner, renameDropBanner, dropBannerFor, clearPromoCache } from '../lib/promos.js'
import InfoTip from './InfoTip.jsx'
import { dropKey } from '../lib/lookbook.js'
import {
  DROPS_MENU,
  fetchAllNavCategories,
  createNavCategory,
  updateNavCategory,
  deleteNavCategory,
} from '../lib/navCategories.js'
import { toLocalInput, fromLocalInput, isScheduled, launchLabel } from '../lib/schedule.js'
import './collection-manager.css'

function taka(n) {
  return '৳ ' + Number(n || 0).toLocaleString()
}

// Products → Collections. A collection is a drop (PAUSE UNIVERSITY, CITYBOY…):
// made here, it shows up in the DROPS menu, the lookbook and Shop by
// collection. Open one to see its products and add new ones straight into it.
// The list is the same rows as Nav menus → DROPS, so the two stay in step.
export default function CollectionManager({ products, open, onOpen, onAddProduct, onEditProduct, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState('')
  // Each collection's banner photo and "coming soon" switch (site_settings
  // drop_banners — see src/lib/promos.js).
  const [banners, setBanners] = useState({})
  const [newBanner, setNewBanner] = useState(null)
  const [bannerBusy, setBannerBusy] = useState(false)

  async function loadBanners() {
    const { banners } = await fetchDropBanners()
    setBanners(banners)
  }
  useEffect(() => { loadBanners() }, [])

  async function saveBanner(name, patch) {
    setBannerBusy(true)
    setError('')
    const { error } = await saveDropBanner(name, patch)
    setBannerBusy(false)
    clearPromoCache()
    if (error) return setError("Couldn't save the banner — has supabase-migration-site-settings.sql been run?")
    loadBanners()
  }

  async function uploadBanner(name, file) {
    setBannerBusy(true)
    setError('')
    try {
      const url = await uploadImage(file, supabase, 'drops')
      await saveBanner(name, { image: url })
    } catch (e) {
      setBannerBusy(false)
      setError(`Couldn't upload the banner: ${e.message}`)
    }
  }

  async function load() {
    const { categories, error } = await fetchAllNavCategories(DROPS_MENU)
    if (error) setError("Couldn't load the collections.")
    setRows(categories)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // The saved collections, plus any drop name a product already carries that
  // was never made into one (so nothing goes missing from this list).
  const collections = useMemo(() => {
    const list = rows.map((r) => ({ name: r.label, row: r }))
    const seen = new Set(list.map((c) => dropKey(c.name)))
    for (const p of products) {
      if (p.drop_name && !seen.has(dropKey(p.drop_name))) {
        seen.add(dropKey(p.drop_name))
        list.push({ name: p.drop_name.trim(), row: null })
      }
    }
    return list
  }, [rows, products])

  const productsIn = (name) => products.filter((p) => dropKey(p.drop_name) === dropKey(name))

  // The collection's launch: the latest launch time among its products that
  // haven't gone live yet (null when everything is already live).
  const launchOf = (items) => {
    const times = items.filter((p) => isScheduled(p)).map((p) => p.publish_at)
    return times.length ? times.sort().at(-1) : null
  }

  const [launchInput, setLaunchInput] = useState('')
  useEffect(() => { setLaunchInput('') }, [open])

  // Sets (or clears, with null) the launch time on every product in the
  // collection at once — upload the whole drop, then give it one time.
  async function scheduleAll(name, iso) {
    const ids = productsIn(name).map((p) => p.id)
    if (!ids.length) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('products').update({ publish_at: iso }).in('id', ids)
    setBusy(false)
    if (error) return setError("Couldn't save the launch time — has supabase-migration-scheduled-products.sql been run?")
    // Visitors can't see products before their launch, so the "coming soon"
    // banner reads the time from here.
    await saveDropBanner(name, { launch_at: iso })
    clearPromoCache()
    loadBanners()
    setLaunchInput('')
    onChanged()
  }

  async function create(e) {
    e.preventDefault()
    const name = newName.trim().toUpperCase()
    if (!name) return
    if (collections.some((c) => dropKey(c.name) === dropKey(name))) {
      setError(`${name} already exists.`)
      return
    }
    setBusy(true)
    setError('')
    const { error } = await createNavCategory({ label: name, sortOrder: rows.length, menu: DROPS_MENU })
    setBusy(false)
    if (error) return setError("Couldn't create it — try again.")
    if (newBanner) await uploadBanner(name, newBanner)
    setNewName('')
    setNewBanner(null)
    load()
  }

  // A drop name that's on products but has no row yet becomes a proper
  // collection (and so appears in the DROPS menu).
  async function adopt(name) {
    setBusy(true)
    await createNavCategory({ label: name, sortOrder: rows.length, menu: DROPS_MENU })
    setBusy(false)
    load()
  }

  // Renaming moves everything that uses the old name: the menu row, the
  // products, the lookbook photos and any sale on the drop.
  async function rename(c, to) {
    const name = to.trim().toUpperCase()
    setRenaming('')
    if (!name || name === c.name) return
    if (collections.some((x) => x !== c && dropKey(x.name) === dropKey(name))) {
      setError(`${name} already exists.`)
      return
    }
    setBusy(true)
    setError('')
    const like = c.name.replace(/[\\%_]/g, (m) => '\\' + m)
    const results = await Promise.all([
      c.row ? updateNavCategory(c.row.id, { label: name }) : createNavCategory({ label: name, sortOrder: rows.length, menu: DROPS_MENU }),
      supabase.from('products').update({ drop_name: name }).ilike('drop_name', like),
      supabase.from('lookbook_looks').update({ drop_name: name }).ilike('drop_name', like),
      supabase.from('sales').update({ drop_name: name }).ilike('drop_name', like),
      renameDropBanner(c.name, name),
    ])
    setBusy(false)
    if (results[0].error || results[1].error) setError("Couldn't rename everything — check the products and try again.")
    if (open && dropKey(open) === dropKey(c.name)) onOpen(name)
    load()
    onChanged()
  }

  async function remove(c) {
    if (productsIn(c.name).length > 0) {
      setError(`${c.name} still has products — move them to another collection first.`)
      return
    }
    if (!window.confirm(`Delete the ${c.name} collection?`)) return
    setBusy(true)
    if (c.row) await deleteNavCategory(c.row.id)
    setBusy(false)
    if (open && dropKey(open) === dropKey(c.name)) onOpen(null)
    load()
  }

  // ---------- One collection open ----------
  if (open) {
    const items = productsIn(open)
    const launch = launchOf(items)
    const waiting = items.filter((p) => isScheduled(p)).length
    const openRow = collections.find((x) => dropKey(x.name) === dropKey(open)) || { name: open, row: null }
    return (
      <section className="panel">
        <div className="orders-head">
          <div>
            <button type="button" className="cl-back mono" onClick={() => onOpen(null)}>← All collections</button>
            {/* The name can be changed from inside too: everything using it moves along. */}
            {renaming === open ? (
              <input
                className="cl-rename cl-rename-title"
                autoFocus
                defaultValue={open}
                aria-label="Collection name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename(openRow, e.currentTarget.value)
                  if (e.key === 'Escape') setRenaming('')
                }}
                onBlur={(e) => rename(openRow, e.currentTarget.value)}
              />
            ) : (
              <h3 className="display cl-title">
                {open}
                <button type="button" className="cl-title-edit mono" onClick={() => setRenaming(open)} disabled={busy}>
                  Edit name
                </button>
              </h3>
            )}
            <div className="panel-note mono">{items.length} product{items.length === 1 ? '' : 's'} in this collection</div>
          </div>
          <button className="add-product mono" onClick={() => onAddProduct(open, launch)}>
            + Add product to {open}
          </button>
        </div>

        <BannerBlock
          name={open}
          banner={dropBannerFor(open, banners)}
          launch={launch}
          busy={bannerBusy}
          onUpload={(f) => uploadBanner(open, f)}
          onSave={(patch) => saveBanner(open, patch)}
        />

        {/* Upload the whole drop first, then give every product one launch
            time — they all appear together, e.g. at 10 pm. */}
        <div className="cl-launch">
          <div className="cl-launch-state mono">
            {launch
              ? `${waiting} of ${items.length} hidden until ${launchLabel(launch)}`
              : 'Live — every product here is showing in the shop'}
          </div>
          <div className="cl-launch-row">
            <input
              type="datetime-local"
              value={launchInput || toLocalInput(launch)}
              onChange={(e) => setLaunchInput(e.target.value)}
            />
            <button
              type="button"
              className="add-product mono"
              disabled={busy || items.length === 0 || !(launchInput || launch)}
              onClick={() => scheduleAll(open, fromLocalInput(launchInput || toLocalInput(launch)))}
            >
              Set launch for all {items.length}
            </button>
            {launch && (
              <button type="button" className="cl-now mono" disabled={busy} onClick={() => scheduleAll(open, null)}>
                Launch now
              </button>
            )}
          </div>
          <em className="cl-hint mono">
            Until then these products are hidden from the shop and can't be ordered. New products added
            here start with the same time; a product can have its own time in its edit form.
          </em>
        </div>

        {items.length === 0 && (
          <div className="empty mono">Nothing in {open} yet — add the first product above.</div>
        )}

        <div className="table">
          {items.map((p) => (
            <div className="trow prow clickable" key={p.id} onClick={() => onEditProduct(p)}>
              <div className="pthumb">
                {Array.isArray(p.images) && p.images[0] && <img src={imgUrl(p.images[0], { w: 120 })} alt="" />}
              </div>
              <div className="tc name">
                {p.name}
                <div className="mini-id mono" style={{ marginTop: '2px' }}>{p.id}</div>
              </div>
              <div className="tc mono dim">{p.variant}</div>
              <div className="tc mono">{taka(p.price)}</div>
              <div className="tc mono dim">{p.category || ''}</div>
              <div className="tc mono dim">
                {isScheduled(p) ? <span className="sched-tag">Live {launchLabel(p.publish_at)}</span> : 'Edit →'}
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  // ---------- All collections ----------
  return (
    <section className="panel">
      <div className="panel-note mono" style={{ marginBottom: '16px' }}>
        Each collection is a drop. Make one here, then open it to add its products —
        nothing else to set up. It joins the DROPS menu, its lookbook and Shop by
        collection on its own the moment its first product is live (at its launch
        time, if it has one). Admin → Lookbook can get its photos ready before that.
      </div>

      <form className="cl-new" onSubmit={create}>
        <input
          value={newName}
          onChange={(e) => { setNewName(e.target.value.toUpperCase()); setError('') }}
          placeholder="New collection name — e.g. WINTER 26"
          maxLength={40}
        />
        <label className="cl-file mono">
          <input type="file" accept="image/*" onChange={(e) => setNewBanner(e.target.files?.[0] || null)} />
          {newBanner ? `Banner: ${newBanner.name}` : '+ Banner image (optional)'}
        </label>
        <InfoTip>A wide photo for this drop. It shows on top of the drop's page in the shop, and small on any sale, coupon or "coming soon" banner for it. It can be added or changed later by opening the collection.</InfoTip>
        <button type="submit" className="add-product mono" disabled={busy || bannerBusy || !newName.trim()}>
          {bannerBusy ? 'Uploading…' : '+ Create collection'}
        </button>
      </form>

      {error && <div className="cl-error mono">{error}</div>}

      {loading && <div className="empty mono">Loading…</div>}
      {!loading && collections.length === 0 && <div className="empty mono">No collections yet — create the first one above.</div>}

      <div className="cl-grid">
        {collections.map((c) => {
          const items = productsIn(c.name)
          const cover = dropBannerFor(c.name, banners)?.image || items.find((p) => p.images?.[0])?.images[0]
          const launch = launchOf(items)
          return (
            <div className="cl-card" key={c.name}>
              <button type="button" className="cl-open" onClick={() => onOpen(c.name)}>
                <div className="cl-cover">
                  {cover ? <img src={imgUrl(cover, { w: 400 })} alt="" /> : <span className="mono">No products yet</span>}
                </div>
                <div className="cl-meta">
                  {renaming === c.name ? null : <span className="cl-name">{c.name}</span>}
                  <span className="mono dim">{items.length} product{items.length === 1 ? '' : 's'}</span>
                  {launch && <span className="sched-tag cl-sched">Launches {launchLabel(launch)}</span>}
                </div>
              </button>

              {renaming === c.name && (
                <input
                  className="cl-rename"
                  autoFocus
                  defaultValue={c.name}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(c, e.currentTarget.value)
                    if (e.key === 'Escape') setRenaming('')
                  }}
                  onBlur={(e) => rename(c, e.currentTarget.value)}
                />
              )}

              <div className="cl-actions mono">
                <button type="button" onClick={() => onOpen(c.name)}>Open</button>
                <button type="button" onClick={() => onAddProduct(c.name, launch)}>+ Product</button>
                <button type="button" onClick={() => setRenaming(c.name)} disabled={busy}>Rename</button>
                {!c.row && <button type="button" onClick={() => adopt(c.name)} disabled={busy} title="Add it to the DROPS menu">Add to menu</button>}
                <button type="button" className="cl-del" onClick={() => remove(c)} disabled={busy}>Delete</button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// The open collection's banner: its photo, and whether to announce it as
// "coming soon" while its launch time is ahead.
function BannerBlock({ name, banner, launch, busy, onUpload, onSave }) {
  const soon = banner?.soon !== false
  return (
    <div className="cl-banner">
      <div className="cl-banner-head mono">
        BANNER IMAGE
        <InfoTip>
          <p>Shown wide on top of {name}'s page in the shop (Shop → this drop), and small on its sale, coupon and "coming soon" banners.</p>
          <p>A wide photo works best (about 3:1, e.g. 1800 × 600). Without one, the banners just show their text.</p>
        </InfoTip>
      </div>
      <div className="cl-banner-row">
        <div className="cl-banner-img">
          {banner?.image ? <img src={imgUrl(banner.image, { w: 900 })} alt="" /> : <span className="mono">No banner yet</span>}
        </div>
        <div className="cl-banner-tools">
          <label className="cl-file mono">
            <input type="file" accept="image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
            {busy ? 'Saving…' : banner?.image ? 'Change image' : '+ Upload image'}
          </label>
          {banner?.image && <button type="button" className="cl-now mono" disabled={busy} onClick={() => onSave({ image: null })}>Remove</button>}
          <label className="cl-soon mono">
            <input type="checkbox" checked={soon} disabled={busy} onChange={(e) => onSave({ soon: e.target.checked })} />
            Show a "coming soon" banner before launch
            <InfoTip>While this collection's launch time (below) is ahead, a "{name} · DROPPING SOON" card with a countdown shows where Website → Banners puts new drops. It goes away by itself at launch.</InfoTip>
          </label>
          <div className="cl-hint mono">{launch ? `Launch: ${launchLabel(launch)}` : 'No launch time set — the "coming soon" banner needs one.'}</div>
        </div>
      </div>
    </div>
  )
}
