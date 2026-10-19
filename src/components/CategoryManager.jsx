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
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'
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

  const visible = cats.filter((c) => c.active)

  return (
    <AdminBox
      title={`${config.navLabel} MENU`}
      side={loading ? '' : `${visible.length} showing${cats.length > visible.length ? ` · ${cats.length - visible.length} hidden` : ''}`}
      tip={
        <>
          <p>{config.intro}</p>
          <p><b>Spelling matters:</b> a name has to match {config.matchHint} exactly, or it opens an empty page. The count on each row says how many products it shows.</p>
          <p>Use ↑ ↓ for the order, the pill to hide or show it, ✕ to take it off the menu.</p>
        </>
      }
    >
      {/* What a shopper sees: the word in the nav and its dropdown. */}
      <div className="cm-preview">
        <span className="cm-preview-word mono">{config.navLabel} ▾</span>
        <div className="cm-preview-list mono">
          {visible.length ? visible.map((c) => <span key={c.id}>{c.label}</span>) : <em>Empty — {config.navLabel} lists every {config.noun} in the catalog</em>}
        </div>
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
          className="ab-input mono"
          placeholder={config.placeholder}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value.toUpperCase())}
          disabled={busy}
        />
        <button className="ab-btn mono" disabled={busy || !newLabel.trim()}>
          {busy ? 'Working…' : '+ Add'}
        </button>
      </form>

      {missing.length > 0 && (
        <div className="cm-suggest mono">
          <span className="ab-label">
            IN YOUR CATALOG, NOT ON THE MENU
            <InfoTip>Spelt exactly as on the products — one tap adds it, so the spelling can't go wrong.</InfoTip>
          </span>
          <div className="cm-chips">
            {missing.map((c) => (
              <button key={c} type="button" onClick={() => add(c)} disabled={busy}>
                + {c} <b>{counts[c]}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="ab-empty mono">Loading…</div>}

      {!loading && cats.length === 0 && (
        <div className="ab-empty mono">
          Nothing on this menu yet. Until you add something, {config.navLabel} falls
          back to every {config.noun} it can find in the catalog.
        </div>
      )}

      {!loading && cats.length > 0 && visible.length === 0 && (
        <div className="ab-warn mono">Every entry is hidden, so the {config.navLabel} dropdown is empty right now.</div>
      )}

      <div className="cm-list">
        {cats.map((c, i) => {
          const count = counts[c.label] || 0

          return (
            <div className={`cm-row ${c.active ? '' : 'off'}`} key={c.id}>
              <span className="cm-pos mono">{i + 1}</span>
              <input
                className="cm-name mono"
                defaultValue={c.label}
                aria-label="Name on the menu"
                onBlur={(e) => rename(c, e.target.value)}
              />
              <span className={`cm-count mono ${count === 0 ? 'zero' : ''}`} title={count === 0 ? 'Opens an empty page — check the spelling' : ''}>
                {count === 0 ? '0 · empty' : count}
              </span>
              <span className="cm-tools">
                <button type="button" className="ab-tool" onClick={() => move(i, -1)} disabled={i === 0 || busy} aria-label="Up">↑</button>
                <button type="button" className="ab-tool" onClick={() => move(i, 1)} disabled={i === cats.length - 1 || busy} aria-label="Down">↓</button>
                <button type="button" className={`ab-switch mono ${c.active ? 'on' : ''}`} onClick={() => toggleActive(c)} disabled={busy}>
                  {c.active ? 'Showing' : 'Hidden'}
                </button>
                {confirmId === c.id ? (
                  <span className="ab-confirm mono">
                    <button type="button" className="ab-yes" onClick={() => remove(c.id)}>Remove</button>
                    <button type="button" className="ab-no" onClick={() => setConfirmId(null)}>No</button>
                  </span>
                ) : (
                  <button type="button" className="ab-tool danger" onClick={() => setConfirmId(c.id)} aria-label="Take off the menu">
                    <IconX width="12" height="12" />
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </AdminBox>
  )
}
