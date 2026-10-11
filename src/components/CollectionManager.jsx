import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl } from '../lib/images.js'
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
    setNewName('')
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
    return (
      <section className="panel">
        <div className="orders-head">
          <div>
            <button type="button" className="cl-back mono" onClick={() => onOpen(null)}>← All collections</button>
            <h3 className="display cl-title">{open}</h3>
            <div className="panel-note mono">{items.length} product{items.length === 1 ? '' : 's'} in this collection</div>
          </div>
          <button className="add-product mono" onClick={() => onAddProduct(open, launch)}>
            + Add product to {open}
          </button>
        </div>

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
        Each collection is a drop. Make one here, then open it to add its products.
        Collections show in the DROPS menu, the lookbook and Shop by collection.
      </div>

      <form className="cl-new" onSubmit={create}>
        <input
          value={newName}
          onChange={(e) => { setNewName(e.target.value.toUpperCase()); setError('') }}
          placeholder="New collection name — e.g. WINTER 26"
          maxLength={40}
        />
        <button type="submit" className="add-product mono" disabled={busy || !newName.trim()}>
          + Create collection
        </button>
      </form>

      {error && <div className="cl-error mono">{error}</div>}

      {loading && <div className="empty mono">Loading…</div>}
      {!loading && collections.length === 0 && <div className="empty mono">No collections yet — create the first one above.</div>}

      <div className="cl-grid">
        {collections.map((c) => {
          const items = productsIn(c.name)
          const cover = items.find((p) => p.images?.[0])?.images[0]
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
