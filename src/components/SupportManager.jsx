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

  if (loading || !draft) return <section className="panel"><div className="empty mono">Loading…</div></section>

  const label = EDITABLE.find((t) => t.slug === slug)?.label

  return (
    <section className="panel sm-panel">
      <div className="panel-label mono">SUPPORT PAGES</div>
      <p className="sm-help">
        Each tab on the storefront's <a href={`/support/${slug}`} target="_blank" rel="noreferrer">Support page</a>.
        Pick one, change the words, save. A blank line in a section starts a new paragraph.
      </p>

      <div className="sm-pages mono">
        {EDITABLE.map((t) => (
          <button key={t.slug} className={slug === t.slug ? 'on' : ''} onClick={() => pick(t.slug)}>
            {t.label}
            {saved[t.slug] && <span className="sm-dot" title="Edited" />}
          </button>
        ))}
      </div>

      <div className="sm-editor">
        <label className="pf-field">
          <span className="mono">PAGE TITLE</span>
          <input value={draft.title || ''} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="pf-field">
          <span className="mono">INTRO</span>
          <textarea rows={2} value={draft.intro || ''} onChange={(e) => set({ intro: e.target.value })} />
        </label>

        {draft.blocks.map((b, i) => (
          <div className="sm-block" key={i}>
            <div className="sm-block-bar mono">
              <span>{b.type === 'table' ? 'TABLE' : b.type === 'contact' ? 'CONTACT CARDS' : 'SECTION'} {i + 1}</span>
              <span className="sm-block-tools">
                <button type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" onClick={() => moveBlock(i, 1)} disabled={i === draft.blocks.length - 1} aria-label="Move down">↓</button>
                <button type="button" onClick={() => removeBlock(i)} aria-label="Remove">✕</button>
              </span>
            </div>

            {b.type !== 'contact' && (
              <input
                className="sm-input"
                placeholder="Heading"
                value={b.heading || ''}
                onChange={(e) => setBlock(i, { heading: e.target.value })}
              />
            )}

            {b.type === 'text' || !b.type ? (
              <textarea
                className="sm-input"
                rows={4}
                value={b.body || ''}
                onChange={(e) => setBlock(i, { body: e.target.value })}
              />
            ) : null}

            {b.type === 'table' && <TableEditor block={b} onChange={(patch) => setBlock(i, patch)} />}
            {b.type === 'contact' && <ContactEditor block={b} onChange={(patch) => setBlock(i, patch)} />}
          </div>
        ))}

        <div className="tk-actions">
          <button type="button" className="tk-add" onClick={() => addBlock('text')}>+ Text section</button>
          <button type="button" className="tk-add" onClick={() => addBlock('table')}>+ Table</button>
          {saved[slug] && (
            <button type="button" className="tk-reset" onClick={reset} disabled={busy}>Back to default</button>
          )}
          <button type="button" className="courier-btn mono tk-save" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : `Save ${label}`}
          </button>
        </div>
        {note && <div className="tk-note mono">{note}</div>}
      </div>
    </section>
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
                <button type="button" onClick={() => onChange({ rows: rows.filter((_, rj) => rj !== ri) })} aria-label="Remove row">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sm-table-tools">
        <button type="button" className="tk-add" onClick={() => onChange({ rows: [...rows, Array(cols).fill('')] })}>+ Row</button>
        <button
          type="button"
          className="tk-add"
          onClick={() => onChange({ head: [...head, 'COLUMN'], rows: rows.map((r) => [...r, '']) })}
        >
          + Column
        </button>
        <button
          type="button"
          className="tk-add"
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
          <button type="button" onClick={() => onChange({ items: items.filter((_, ii) => ii !== i) })} aria-label="Remove">✕</button>
        </div>
      ))}
      <button
        type="button"
        className="tk-add"
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

  if (loading) return <section className="panel"><div className="empty mono">Loading…</div></section>

  return (
    <section className="panel sm-panel">
      <div className="panel-label mono">RETURN &amp; EXCHANGE PORTAL</div>
      <p className="sm-help">
        The card on <a href="/support/portal" target="_blank" rel="noreferrer">/support/portal</a> — photo on the
        left, the order check on the right.
      </p>

      <div className="sm-portal">
        <div className="sm-portal-photo">
          {portal.image ? <img src={imgUrl(portal.image, { w: 600 })} alt="" /> : <span className="mono dim">No photo</span>}
        </div>
        <div>
          <label className={`sm-upload mono ${busy ? 'busy' : ''}`}>
            {busy ? 'Working…' : portal.image ? 'Change photo' : 'Upload photo'}
            <input type="file" accept="image/*" onChange={upload} disabled={busy} />
          </label>
          {portal.image && (
            <button type="button" className="tk-reset sm-remove" disabled={busy} onClick={() => save({ ...portal, image: '' }, 'Photo removed.')}>
              Remove photo
            </button>
          )}
          <label className="pf-field">
            <span className="mono">HEADING</span>
            <input value={portal.heading} onChange={(e) => { setPortal({ ...portal, heading: e.target.value }); setNote('') }} />
          </label>
          <label className="pf-field">
            <span className="mono">TEXT UNDER THE BUTTON</span>
            <textarea rows={3} value={portal.intro} onChange={(e) => { setPortal({ ...portal, intro: e.target.value }); setNote('') }} />
          </label>
          <div className="tk-actions">
            <button type="button" className="courier-btn mono tk-save" disabled={busy} onClick={() => save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {note && <div className="tk-note mono">{note}</div>}
        </div>
      </div>
    </section>
  )
}
