import { useEffect, useState } from 'react'
import useDraft from '../lib/useDraft.js'
import DraftNote from './DraftNote.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl, uploadImage } from '../lib/images.js'
import { OWN_PAGES, basePage } from '../content/info-pages.js'
import {
  DEFAULT_PORTAL,
  fetchPortal,
  fetchSupportPages,
  fetchSupportTabs,
  savePortal,
  saveSupportPages,
  saveSupportTabs,
} from '../lib/support.js'
import useDragSort from '../lib/useDragSort.js'
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'
import './support-manager.css'

const MIGRATION = 'has supabase-migration-support.sql been run?'

// ---------------------------------------------------------------------------
// Admin → Support → Support pages
// ---------------------------------------------------------------------------
// The tabs on /support — rename, hide, reorder (drag ⋮⋮), add your own —
// and every page's copy: title, intro and its sections (text, a table, or
// contact cards), the tabs' and the footer's own pages (Privacy policy,
// Terms of service). A page never saved here shows the built-in copy;
// "Back to default" drops the saved one again. About us is the About us
// page's blocks (Website → About us); the portal has its own box below.

const OWN_EDITABLE = OWN_PAGES.filter((t) => t.slug !== 'portal')
const isCustom = (slug) => slug.startsWith('page-')

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

export function SupportPages() {
  const [saved, setSaved] = useState({})
  const [tabs, setTabs] = useState([])
  const [slug, setSlug] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [tabNote, setTabNote] = useState('')
  const [newTab, setNewTab] = useState('')

  const labelOf = (s, list = tabs) => list.find((t) => t.slug === s)?.label || OWN_PAGES.find((t) => t.slug === s)?.label || s
  // A page as it is now: the saved copy over its built-in one.
  const pageFor = (s, sv = saved, list = tabs) => {
    const base = basePage(s, labelOf(s, list))
    return clone(sv[s] && Array.isArray(sv[s].blocks) ? { ...base, ...sv[s] } : base)
  }

  useEffect(() => {
    Promise.all([fetchSupportPages(), fetchSupportTabs()]).then(([{ saved, error }, { tabs }]) => {
      setSaved(saved)
      setTabs(tabs)
      const first = tabs.find((t) => t.slug !== 'about')?.slug || OWN_EDITABLE[0].slug
      setSlug(first)
      setDraft(pageFor(first, saved, tabs))
      setLoading(false)
      if (error) setNote(`Couldn't load the saved pages — ${MIGRATION}`)
    })
  }, [])

  // The tab row is saved the moment it changes.
  async function saveTabs(next, done = 'Saved — the tab row is live.') {
    setTabs(next)
    const { error } = await saveSupportTabs(next)
    setTabNote(error ? "Couldn't save the tabs — try again." : done)
  }
  const drag = useDragSort(tabs, setTabs, (next) => saveTabs(next))

  function addTab(e) {
    e.preventDefault()
    const label = newTab.trim()
    if (!label) return
    const s = `page-${Date.now().toString(36)}`
    const next = [...tabs, { slug: s, label, on: true }]
    setNewTab('')
    saveTabs(next, `Added ${label} — write its page on the right, then Save.`)
    setSlug(s)
    setDraft(clone(basePage(s, label)))
    setNote('')
  }

  function renameTab(s, label) {
    const clean = label.trim()
    if (!clean || clean === labelOf(s)) return
    saveTabs(tabs.map((t) => (t.slug === s ? { ...t, label: clean } : t)))
  }

  function removeTab(s) {
    if (!window.confirm(`Delete the ${labelOf(s)} tab and its page?`)) return
    const next = tabs.filter((t) => t.slug !== s)
    saveTabs(next, 'Deleted.')
    if (saved[s]) {
      const pages = { ...saved }
      delete pages[s]
      saveSupportPages(pages).then(({ error }) => { if (!error) setSaved(pages) })
    }
    if (slug === s) {
      const first = next.find((t) => t.slug !== 'about')?.slug || OWN_EDITABLE[0].slug
      setSlug(first)
      setDraft(pageFor(first, saved, next))
    }
  }

  // Unsaved words on a page stay in this browser until Save (one draft per page).
  const kept = useDraft(`support:${slug}`, draft, setDraft, { enabled: !loading && Boolean(draft) })

  function pick(next) {
    if (next === slug || next === 'about') return
    setSlug(next)
    setDraft(pageFor(next))
    setNote('')
  }

  function set(patch) {
    setDraft((d) => ({ ...d, ...patch }))
    setNote('')
  }

  function setBlock(i, patch) {
    set({ blocks: draft.blocks.map((b, bi) => (bi === i ? { ...b, ...patch } : b)) })
  }

  function moveBlock(i, dir) {
    const j = i + dir
    if (j < 0 || j >= draft.blocks.length) return
    const next = [...draft.blocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ blocks: next })
  }

  function removeBlock(i) {
    set({ blocks: draft.blocks.filter((_, bi) => bi !== i) })
  }

  function addBlock(type) {
    const block =
      type === 'table'
        ? { type: 'table', heading: 'New table', head: ['COLUMN', 'COLUMN'], rows: [['', '']] }
        : { type: 'text', heading: 'New section', body: '' }
    set({ blocks: [...draft.blocks, block] })
  }

  async function persist(next, done, shown) {
    setBusy(true)
    const { error } = await saveSupportPages(next)
    setBusy(false)
    if (error) return setNote(`Couldn't save — ${MIGRATION}`)
    setSaved(next)
    kept.saved(shown)
    setNote(done)
  }

  function save() {
    const clean = {
      ...draft,
      title: (draft.title || '').trim() || basePage(slug, labelOf(slug)).title,
      intro: (draft.intro || '').trim(),
    }
    setDraft(clean)
    persist({ ...saved, [slug]: clean }, 'Saved — live on the Support page now.', clean)
  }

  function reset() {
    const next = { ...saved }
    delete next[slug]
    const fresh = clone(basePage(slug, labelOf(slug)))
    setDraft(fresh)
    persist(next, 'Back to the built-in copy.', fresh)
  }

  if (loading || !draft) return <div className="ab-empty mono">Loading…</div>

  const label = labelOf(slug)
  const base = basePage(slug, label)
  const current = saved[slug] && Array.isArray(saved[slug].blocks) ? { ...base, ...saved[slug] } : base
  // Merged onto the built-in page both sides, so key order can't count as a change.
  const dirty = JSON.stringify({ ...base, ...draft }) !== JSON.stringify(current)
  const onRow = tabs.some((t) => t.slug === slug)
  const KIND = { table: 'TABLE', contact: 'CONTACT CARDS', text: 'TEXT' }

  return (
    <div className="sm-layout">
      <DraftNote draft={kept} />
      {/* ---- Which page ---- */}
      <AdminBox
        title="PAGES"
        tip={
          <>
            <p><b>Support tabs</b>: the row on top of the Support page (the footer's SUPPORT opens the first). Drag ⋮⋮ to reorder, On / Off to take one off the row, ✕ to delete one you added, and + Add for a new one. Pick one to write its page.</p>
            <p><b>Own pages</b>: Privacy policy and Terms of service open from the footer on their own, without the row.</p>
            <p>A dot means it's been edited here; the others show the built-in copy. About Us shows the About us page (Website → About us).</p>
          </>
        }
        className="sm-nav"
      >
        <span className="ab-label">SUPPORT TABS</span>
        <div className="sm-pages mono">
          {tabs.map((t, i) => (
            <div className={`sm-tab ${t.on === false ? 'off' : ''} ${drag.dragging === i ? 'dragging' : ''}`} key={t.slug} {...drag.row(i)}>
              <span className="sm-grip" {...drag.handle(i)}>⋮⋮</span>
              <button type="button" className={slug === t.slug ? 'on' : ''} onClick={() => pick(t.slug)} title={t.slug === 'about' ? 'Written in Website → About us' : undefined}>
                <span>{t.label}</span>
                {saved[t.slug] && <em><i className="sm-dot" /></em>}
              </button>
              <button type="button" className={`ab-switch mono ${t.on === false ? '' : 'on'}`} title={t.on === false ? 'Hidden — tap to show it on the row' : 'On the row — tap to hide it'} onClick={() => saveTabs(tabs.map((x) => (x.slug === t.slug ? { ...x, on: x.on === false } : x)))}>
                {t.on === false ? 'Off' : 'On'}
              </button>
              {isCustom(t.slug) && (
                <button type="button" className="ab-tool danger" onClick={() => removeTab(t.slug)} aria-label={`Delete ${t.label}`}>✕</button>
              )}
            </div>
          ))}
        </div>
        <form className="sm-addtab" onSubmit={addTab}>
          <input className="ab-input" value={newTab} onChange={(e) => setNewTab(e.target.value)} placeholder="New support option, e.g. Care guide" maxLength={40} />
          <button type="submit" className="ab-btn mono" disabled={!newTab.trim()}>+ Add</button>
        </form>
        {tabNote && <div className="ab-note mono">{tabNote}</div>}

        <span className="ab-label" style={{ marginTop: 16 }}>OWN PAGES</span>
        <div className="sm-pages mono">
          {OWN_EDITABLE.map((t) => (
            <button key={t.slug} type="button" className={slug === t.slug ? 'on' : ''} onClick={() => pick(t.slug)}>
              <span>{t.label}</span>
              <em>{saved[t.slug] ? <><i className="sm-dot" /> Edited</> : 'Built-in'}</em>
            </button>
          ))}
        </div>
      </AdminBox>

      {/* ---- The page ---- */}
      <AdminBox
        title={`EDITING · ${(label || '').toUpperCase()}`}
        side={<a href={`/support/${slug}`} target="_blank" rel="noreferrer">Open the page ↗</a>}
        tip={
          <>
            <p>The page title, a short intro, then its sections in order — ↑ ↓ moves one, ✕ removes it.</p>
            <p>A <b>text</b> section is a heading and words (an empty line starts a new paragraph). A <b>table</b> has its own columns and rows.</p>
            <p>Nothing changes on the site until <b>Save</b>. <b>Back to default</b> brings the built-in copy back.</p>
          </>
        }
        className="sm-edit"
      >
        {onRow && (
          <>
            <span className="ab-label">TAB NAME</span>
            <input className="ab-input" key={`tab-${slug}`} defaultValue={label} maxLength={40} onBlur={(e) => renameTab(slug, e.target.value)} />
          </>
        )}
        <span className="ab-label">PAGE TITLE</span>
        <input className="ab-input" value={draft.title || ''} onChange={(e) => set({ title: e.target.value })} />
        <span className="ab-label">INTRO</span>
        <textarea className="ab-input" rows={2} value={draft.intro || ''} onChange={(e) => set({ intro: e.target.value })} />

        <span className="ab-label">SECTIONS</span>
        <div className="sm-blocks">
          {draft.blocks.map((b, i) => (
            <div className="sm-block" key={i}>
              <div className="sm-block-bar mono">
                <span className="sm-kind">{i + 1} · {KIND[b.type] || 'TEXT'}</span>
                <span className="sm-block-tools">
                  <button type="button" className="ab-tool" onClick={() => moveBlock(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button type="button" className="ab-tool" onClick={() => moveBlock(i, 1)} disabled={i === draft.blocks.length - 1} aria-label="Move down">↓</button>
                  <button type="button" className="ab-tool danger" onClick={() => removeBlock(i)} aria-label="Remove">✕</button>
                </span>
              </div>

              {b.type !== 'contact' && (
                <input
                  className="ab-input sm-heading"
                  placeholder="Heading"
                  value={b.heading || ''}
                  onChange={(e) => setBlock(i, { heading: e.target.value })}
                />
              )}

              {b.type === 'text' || !b.type ? (
                <textarea
                  className="ab-input"
                  rows={4}
                  value={b.body || ''}
                  onChange={(e) => setBlock(i, { body: e.target.value })}
                />
              ) : null}

              {b.type === 'table' && <TableEditor block={b} onChange={(patch) => setBlock(i, patch)} />}
              {b.type === 'contact' && <ContactEditor block={b} onChange={(patch) => setBlock(i, patch)} />}
            </div>
          ))}
        </div>

        <div className="ab-row sm-add">
          <button type="button" className="ab-btn ghost mono" onClick={() => addBlock('text')}>+ Text section</button>
          <button type="button" className="ab-btn ghost mono" onClick={() => addBlock('table')}>+ Table</button>
        </div>

        {/* Kept in view at the bottom while the page is long. */}
        <div className="sm-savebar">
          <span className={`sm-state mono ${dirty ? 'dirty' : ''}`}>{note || (dirty ? '● Unsaved changes' : saved[slug] ? 'Saved' : 'Built-in copy')}</span>
          {saved[slug] && (
            <button type="button" className="ab-btn ghost mono" onClick={reset} disabled={busy}>Back to default</button>
          )}
          <button type="button" className="ab-btn mono" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : `Save ${label}`}
          </button>
        </div>
      </AdminBox>
    </div>
  )
}

function TableEditor({ block, onChange }) {
  const head = block.head || []
  const rows = block.rows || []
  const cols = head.length

  return (
    <div className="sm-table-wrap">
      <table className="sm-table">
        <thead>
          <tr>
            {head.map((h, ci) => (
              <th key={ci}>
                <input
                  value={h}
                  onChange={(e) => onChange({ head: head.map((x, xi) => (xi === ci ? e.target.value : x)) })}
                />
              </th>
            ))}
            <th className="sm-tool" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {Array.from({ length: cols }, (_, ci) => (
                <td key={ci}>
                  <input
                    value={row[ci] ?? ''}
                    onChange={(e) =>
                      onChange({
                        rows: rows.map((r, rj) =>
                          rj === ri ? Array.from({ length: cols }, (_, k) => (k === ci ? e.target.value : r[k] ?? '')) : r
                        ),
                      })
                    }
                  />
                </td>
              ))}
              <td className="sm-tool">
                <button type="button" className="ab-tool danger" onClick={() => onChange({ rows: rows.filter((_, rj) => rj !== ri) })} aria-label="Remove row">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sm-table-tools">
        <button type="button" className="ab-btn ghost mono" onClick={() => onChange({ rows: [...rows, Array(cols).fill('')] })}>+ Row</button>
        <button
          type="button"
          className="ab-btn ghost mono"
          onClick={() => onChange({ head: [...head, 'COLUMN'], rows: rows.map((r) => [...r, '']) })}
        >
          + Column
        </button>
        <button
          type="button"
          className="ab-btn ghost mono"
          disabled={cols <= 1}
          onClick={() => onChange({ head: head.slice(0, -1), rows: rows.map((r) => r.slice(0, cols - 1)) })}
        >
          − Last column
        </button>
      </div>
    </div>
  )
}

function ContactEditor({ block, onChange }) {
  const items = block.items || []
  function setItem(i, patch) {
    onChange({ items: items.map((it, ii) => (ii === i ? { ...it, ...patch } : it)) })
  }
  return (
    <div className="sm-contacts">
      {items.map((it, i) => (
        <div className="sm-contact" key={i}>
          <input placeholder="LABEL" value={it.label || ''} onChange={(e) => setItem(i, { label: e.target.value.toUpperCase() })} />
          <input placeholder="What's shown" value={it.value || ''} onChange={(e) => setItem(i, { value: e.target.value })} />
          <input placeholder="Link (mailto:, tel:, https://)" value={it.href || ''} onChange={(e) => setItem(i, { href: e.target.value })} />
          <button type="button" className="ab-tool danger" onClick={() => onChange({ items: items.filter((_, ii) => ii !== i) })} aria-label="Remove">✕</button>
        </div>
      ))}
      <button
        type="button"
        className="ab-btn ghost mono"
        onClick={() => onChange({ items: [...items, { label: 'LABEL', value: '', href: '' }] })}
      >
        + Contact card
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Admin → Support → Return portal
// ---------------------------------------------------------------------------

export function SupportPortal() {
  const [portal, setPortal] = useState(DEFAULT_PORTAL)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    fetchPortal().then(({ portal, error }) => {
      setPortal(portal)
      setLoading(false)
      if (error) setNote(`Couldn't load — ${MIGRATION}`)
    })
  }, [])

  async function save(next = portal, done = 'Saved — live on the portal now.') {
    setBusy(true)
    const { error } = await savePortal(next)
    setBusy(false)
    if (error) return setNote(`Couldn't save — ${MIGRATION}`)
    setPortal(next)
    setNote(done)
  }

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setNote('')
    try {
      const url = await uploadImage(file, supabase, 'support')
      setBusy(false)
      await save({ ...portal, image: url }, 'Photo saved.')
    } catch (err) {
      setBusy(false)
      setNote(`Upload failed — ${err.message}`)
    }
  }

  if (loading) return <div className="ab-empty mono">Loading…</div>

  return (
    <div className="ab-grid stretch">
      <AdminBox
        title="PHOTO"
        tip="The photo on the left of the portal card. A portrait shot (4:5) fits best."
        side={<a href="/support/portal" target="_blank" rel="noreferrer">Open the portal ↗</a>}
      >
        <div className="sm-portal-photo">
          {portal.image ? <img src={imgUrl(portal.image, { w: 600 })} alt="" /> : <span className="mono dim">No photo</span>}
        </div>
        <div className="ab-row sm-photo-actions">
          <label className={`ab-btn ${portal.image ? 'ghost' : ''} mono sm-upload ${busy ? 'busy' : ''}`}>
            {busy ? 'Working…' : portal.image ? 'Change photo' : 'Upload photo'}
            <input type="file" accept="image/*" onChange={upload} disabled={busy} hidden />
          </label>
          {portal.image && (
            <button type="button" className="ab-btn ghost mono" disabled={busy} onClick={() => save({ ...portal, image: '' }, 'Photo removed.')}>
              Remove
            </button>
          )}
        </div>
      </AdminBox>

      <AdminBox
        title="WORDS"
        tip="The heading over the order check, and the line under its button — e.g. how many days a return can be asked for. Saved when you press Save."
      >
        <span className="ab-label">HEADING</span>
        <input className="ab-input" value={portal.heading} onChange={(e) => { setPortal({ ...portal, heading: e.target.value }); setNote('') }} />
        <span className="ab-label">TEXT UNDER THE BUTTON</span>
        <textarea className="ab-input" rows={4} value={portal.intro} onChange={(e) => { setPortal({ ...portal, intro: e.target.value }); setNote('') }} />
        <div className="ab-row sm-portal-save">
          <button type="button" className="ab-btn mono" disabled={busy} onClick={() => save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {note && <span className="ab-note mono">{note}</span>}
        </div>
      </AdminBox>
    </div>
  )
}
