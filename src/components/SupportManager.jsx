import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl, uploadImage } from '../lib/images.js'
import { INFO_PAGES, SUPPORT_TABS } from '../content/info-pages.js'
import {
  DEFAULT_PORTAL,
  fetchPortal,
  fetchSupportPages,
  savePortal,
  saveSupportPages,
} from '../lib/support.js'
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'
import './support-manager.css'

const MIGRATION = 'has supabase-migration-support.sql been run?'

// ---------------------------------------------------------------------------
// Admin → Support → Support pages
// ---------------------------------------------------------------------------
// Every tab on /support except the portal: title, intro and its sections
// (text, a table, or contact cards). A page never saved here shows the
// built-in copy; "Back to default" drops the saved one again.

const EDITABLE = SUPPORT_TABS.filter((t) => t.slug !== 'portal')

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

export function SupportPages() {
  const [saved, setSaved] = useState({})
  const [slug, setSlug] = useState(EDITABLE[0].slug)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    fetchSupportPages().then(({ pages, saved, error }) => {
      setSaved(saved)
      setDraft(clone(pages[EDITABLE[0].slug]))
      setLoading(false)
      if (error) setNote(`Couldn't load the saved pages — ${MIGRATION}`)
    })
  }, [])

  function pick(next) {
    if (next === slug) return
    if (dirty && !window.confirm('You have changes on this page that aren\'t saved. Leave them?')) return
    setSlug(next)
    setDraft(clone(saved[next] && Array.isArray(saved[next].blocks) ? { ...INFO_PAGES[next], ...saved[next] } : INFO_PAGES[next]))
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

  async function persist(next, done) {
    setBusy(true)
    const { error } = await saveSupportPages(next)
    setBusy(false)
    if (error) return setNote(`Couldn't save — ${MIGRATION}`)
    setSaved(next)
    setNote(done)
  }

  function save() {
    const clean = {
      ...draft,
      title: (draft.title || '').trim() || INFO_PAGES[slug].title,
      intro: (draft.intro || '').trim(),
    }
    setDraft(clean)
    persist({ ...saved, [slug]: clean }, 'Saved — live on the Support page now.')
  }

  function reset() {
    const next = { ...saved }
    delete next[slug]
    setDraft(clone(INFO_PAGES[slug]))
    persist(next, 'Back to the built-in copy.')
  }

  if (loading || !draft) return <div className="ab-empty mono">Loading…</div>

  const label = EDITABLE.find((t) => t.slug === slug)?.label
  const current = saved[slug] && Array.isArray(saved[slug].blocks) ? { ...INFO_PAGES[slug], ...saved[slug] } : INFO_PAGES[slug]
  // Merged onto the built-in page both sides, so key order can't count as a change.
  const dirty = JSON.stringify({ ...INFO_PAGES[slug], ...draft }) !== JSON.stringify(current)
  const KIND = { table: 'TABLE', contact: 'CONTACT CARDS', text: 'TEXT' }

  return (
    <div className="sm-layout">
      {/* ---- Which page ---- */}
      <AdminBox
        title="PAGES"
        tip="Every tab on the storefront's Support page. Pick one to change its words. A dot means it's been edited here; the others show the built-in copy."
        className="sm-nav"
      >
        <div className="sm-pages mono">
          {EDITABLE.map((t) => (
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
