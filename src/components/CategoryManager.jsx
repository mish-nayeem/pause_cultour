import { useEffect, useMemo, useState } from 'react'
import {
  SHOP_MENU,
  fetchAllNavCategories,
  createNavCategory,
  updateNavCategory,
  deleteNavCategory,
  reorderNavCategories,
} from '../lib/navCategories.js'
import { IconX } from './Icons.jsx'
import './category-manager.css'

// The two dropdowns differ only in wording and which product field an entry has
// to match, so one component covers both.
const MENUS = {
  shop: {
    navLabel: 'SHOP',
    productField: 'category',
    noun: 'category',
    placeholder: 'Category name, e.g. HOODIES',
    intro:
      'This is the list that drops down under SHOP in the nav. Hiding or ' +
      'deleting a name here only takes it off the menu — the products stay in ' +
      'the catalog, so you can put the category back the day it restocks.',
    matchHint: "the Category you pick on a product",
  },
  drops: {
    navLabel: 'DROPS',
    productField: 'drop',
    noun: 'drop',
    placeholder: 'Drop name, e.g. DROP 03',
    intro:
      'This is the list that drops down under DROPS in the nav. Add a drop ' +
      'when it goes live and hide it once it has sold through — the products ' +
      'stay in the catalog either way.',
    matchHint: "the Drop field you fill in on a product",
  },
}

export default function CategoryManager({ menu = SHOP_MENU, products = [] }) {
  const config = MENUS[menu]

  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [confirmId, setConfirmId] = useState(null)

  async function load() {
    setLoading(true)
    const { categories, error } = await fetchAllNavCategories(menu)
    if (error) {
      setError(
        `Couldn't load the ${config.navLabel} menu — did you run the menu SQL in Supabase? (${error.message})`
      )
    }
    setCats(categories)
    setLoading(false)
  }

  useEffect(() => { load() }, [menu])

  // How many products sit behind each name, so it's obvious before publishing
  // whether a menu item leads somewhere with stock in it.
  const counts = useMemo(() => {
    const map = {}
    for (const p of products) {
      const value = p[config.productField]
      if (value) map[value] = (map[value] || 0) + 1
    }
    return map
  }, [products, config.productField])

  // Values the catalog uses that aren't on the menu yet — one click to add
  // saves retyping the spelling, which has to match exactly to filter.
  const missing = useMemo(() => {
    const onMenu = new Set(cats.map((c) => c.label))
    return Object.keys(counts).filter((c) => !onMenu.has(c)).sort()
  }, [counts, cats])

  async function add(label) {
    const clean = label.trim().toUpperCase()
    if (!clean) return

    if (cats.some((c) => c.label === clean)) {
      setError(`"${clean}" is already on the ${config.navLabel} menu.`)
      return
    }

    setBusy(true)
    setError('')
    const { error } = await createNavCategory({ label: clean, sortOrder: cats.length, menu })
    if (error) setError(`Could not add that ${config.noun}.`)
    setNewLabel('')
    await load()
    setBusy(false)
  }

  async function rename(cat, label) {
    const clean = label.trim().toUpperCase()
    if (!clean || clean === cat.label) return
    setBusy(true)
    await updateNavCategory(cat.id, { label: clean })
    await load()
    setBusy(false)
  }

  async function toggleActive(cat) {
    setBusy(true)
    await updateNavCategory(cat.id, { active: !cat.active })
    await load()
    setBusy(false)
  }

  async function move(index, dir) {
    const target = index + dir
    if (target < 0 || target >= cats.length) return

    const next = [...cats]
    ;[next[index], next[target]] = [next[target], next[index]]

    setCats(next) // optimistic, so the list doesn't jump while saving
    setBusy(true)
    await reorderNavCategories(next)
    await load()
    setBusy(false)
  }

  async function remove(id) {
    setBusy(true)
    await deleteNavCategory(id)
    setConfirmId(null)
    await load()
    setBusy(false)
  }

  const visibleCount = cats.filter((c) => c.active).length

  return (
    <section className="panel">
      <div className="panel-label mono" style={{ marginBottom: '12px' }}>
        {config.navLabel} DROPDOWN
      </div>

      <div className="panel-note mono" style={{ marginBottom: '18px' }}>
        {config.intro}
      </div>

      {error && <div className="err-banner mono">{error}</div>}

      <form
        className="cm-add"
        onSubmit={(e) => {
          e.preventDefault()
          add(newLabel)
        }}
      >
        <input
          className="cm-input mono"
          placeholder={config.placeholder}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value.toUpperCase())}
          disabled={busy}
        />
        <button className="cm-add-btn mono" disabled={busy || !newLabel.trim()}>
          {busy ? 'Working…' : '+ Add to menu'}
        </button>
      </form>

      <div className="cm-note mono">
        <strong>Spelling matters:</strong> the name has to match {config.matchHint} exactly,
        or the menu item opens an empty page. The count next to each row tells
        you how many products it will show.
      </div>

      {missing.length > 0 && (
        <div className="cm-suggest mono">
          <span className="cm-suggest-label">In your catalog but not on the menu:</span>
          {missing.map((c) => (
            <button key={c} onClick={() => add(c)} disabled={busy}>
              + {c} ({counts[c]})
            </button>
          ))}
        </div>
      )}

      {loading && <div className="empty mono">Loading…</div>}

      {!loading && cats.length === 0 && (
        <div className="empty mono">
          Nothing on this menu yet. Until you add something, {config.navLabel} falls
          back to every {config.noun} it can find in the catalog.
        </div>
      )}

      {!loading && cats.length > 0 && visibleCount === 0 && (
        <div className="cm-warn mono">
          Every entry is hidden, so the {config.navLabel} dropdown is empty right now.
        </div>
      )}

      <div className="cm-list">
        {cats.map((c, i) => {
          const count = counts[c.label] || 0

          return (
            <div className={`cm-row ${c.active ? '' : 'off'}`} key={c.id}>
              <input
                className="cm-name"
                defaultValue={c.label}
                onBlur={(e) => rename(c, e.target.value)}
              />

              <div className={`cm-count mono ${count === 0 ? 'zero' : ''}`}>
                {count === 0 ? 'no products' : `${count} product${count === 1 ? '' : 's'}`}
              </div>

              <div className="cm-order mono">
                <button onClick={() => move(i, -1)} disabled={i === 0 || busy}>←</button>
                <span>{i + 1}</span>
                <button onClick={() => move(i, 1)} disabled={i === cats.length - 1 || busy}>→</button>
              </div>

              <button className="cm-toggle mono" onClick={() => toggleActive(c)} disabled={busy}>
                {c.active ? 'On menu' : 'Hidden'}
              </button>

              {confirmId === c.id ? (
                <div className="cm-confirm mono">
                  <button className="cm-danger" onClick={() => remove(c.id)}>Delete</button>
                  <button className="cm-ghost" onClick={() => setConfirmId(null)}>No</button>
                </div>
              ) : (
                <button
                  className="cm-x"
                  onClick={() => setConfirmId(c.id)}
                  title="Remove from menu"
                >
                  <IconX width="14" height="14" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
