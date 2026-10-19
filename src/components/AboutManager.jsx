import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl, uploadImage } from '../lib/images.js'
import {
  fetchAllAboutBlocks,
  createAboutBlock,
  updateAboutBlock,
  deleteAboutBlock,
  reorderAboutBlocks,
} from '../lib/about.js'
import { IconX } from './Icons.jsx'
import AdminBox from './AdminBox.jsx'
import './about-manager.css'

export default function AboutManager() {
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newHeading, setNewHeading] = useState('')
  const [newText, setNewText] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  // The photo picked for the next block, shown before it's uploaded.
  const [pick, setPick] = useState(null) // { file, url }

  async function load() {
    setLoading(true)
    const { blocks, error } = await fetchAllAboutBlocks()
    if (error) {
      setError(
        `Couldn't load the about page — did you run the about SQL in Supabase? (${error.message})`
      )
    }
    setBlocks(blocks)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (pick) URL.revokeObjectURL(pick.url)
    setPick({ file, url: URL.createObjectURL(file) })
    setError('')
  }

  async function addBlock() {
    if (!pick) return setError('Pick the photo for this block.')
    if (!newHeading.trim() && !newText.trim()) return setError('Write the heading or text that goes next to the photo.')

    setBusy(true)
    setError('')

    try {
      const url = await uploadImage(pick.file, supabase, 'about')
      const { error: createError } = await createAboutBlock({
        imageUrl: url,
        heading: newHeading.trim(),
        description: newText.trim(),
        sortOrder: blocks.length,
      })
      if (createError) throw new Error('Could not save the block')
      URL.revokeObjectURL(pick.url)
      setPick(null)
      setNewHeading('')
      setNewText('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // A block's photo swapped for another; heading and text stay.
  async function changePhoto(block, e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const url = await uploadImage(file, supabase, 'about')
      const { error } = await updateAboutBlock(block.id, { image_url: url })
      if (error) throw new Error("Couldn't change the photo — try again.")
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Heading and text save on their own, each when you click away from it.
  async function saveField(block, field, value) {
    if (value.trim() === (block[field] || '')) return
    setBusy(true)
    const { error } = await updateAboutBlock(block.id, { [field]: value.trim() })
    if (error) {
      setError(
        field === 'heading'
          ? "Couldn't save the heading — has supabase-migration-about-heading.sql been run?"
          : "Couldn't save the text — try again."
      )
    }
    await load()
    setBusy(false)
  }

  async function toggleActive(block) {
    setBusy(true)
    await updateAboutBlock(block.id, { active: !block.active })
    await load()
    setBusy(false)
  }

  async function move(index, dir) {
    const target = index + dir
    if (target < 0 || target >= blocks.length) return

    const next = [...blocks]
    ;[next[index], next[target]] = [next[target], next[index]]

    setBlocks(next) // optimistic, so the list doesn't jump while saving
    setBusy(true)
    await reorderAboutBlocks(next)
    await load()
    setBusy(false)
  }

  async function remove(id) {
    setBusy(true)
    await deleteAboutBlock(id)
    setConfirmId(null)
    await load()
    setBusy(false)
  }

  const visible = blocks.filter((b) => b.active)

  return (
    <div className="ab-grid stretch about-m">
      {error && <div className="err-banner mono ab-wide">{error}</div>}

      {/* ---- Add a block ---- */}
      <AdminBox
        title="ADD A BLOCK"
        tip={
          <>
            <p>The About us page is a list of blocks: a photo with a heading and text beside it — photo left, words right on a computer; stacked on a phone.</p>
            <p>Write the words, pick the photo, then <b>Add block</b>. An empty line in the text starts a new paragraph.</p>
            <p><b>Photo:</b> about 1600 px wide. It shows at its own shape, so portrait and landscape both work.</p>
          </>
        }
      >
        <div className="about-add">
          <label className={`about-pick ${pick ? 'has' : ''}`}>
            {pick ? <img src={pick.url} alt="" /> : <span className="mono">+ Pick photo</span>}
            <input type="file" accept="image/*" onChange={pickPhoto} disabled={busy} hidden />
          </label>
          <div className="about-add-fields">
            <span className="ab-label">HEADING</span>
            <input
              className="ab-input"
              placeholder="e.g. Made in Dhaka, worn everywhere"
              value={newHeading}
              onChange={(e) => setNewHeading(e.target.value)}
              maxLength={120}
            />
            <span className="ab-label">TEXT</span>
            <textarea
              className="ab-input"
              placeholder="The words beside the photo…"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              rows={4}
            />
          </div>
        </div>
        <div className="ab-row about-add-actions">
          <button type="button" className="ab-btn mono" onClick={addBlock} disabled={busy || !pick}>
            {busy ? 'Working…' : 'Add block'}
          </button>
          {pick && <button type="button" className="ab-btn ghost mono" onClick={() => { URL.revokeObjectURL(pick.url); setPick(null) }}>Change photo</button>}
        </div>
      </AdminBox>

      {/* ---- Preview ---- */}
      <AdminBox
        title="PREVIEW"
        side={<a href="/about" target="_blank" rel="noreferrer">Open the page ↗</a>}
        tip="The About us page as it reads now, top to bottom — hidden blocks left out."
      >
        <div className="about-prev" data-lenis-prevent>
          <div className="about-prev-title">ABOUT US</div>
          {visible.length === 0 ? (
            <div className="about-prev-empty mono">Nothing showing yet — the page says the story is coming.</div>
          ) : (
            visible.map((b) => (
              <div className="about-prev-block" key={b.id}>
                <img src={imgUrl(b.image_url, { w: 200 })} alt="" />
                <div>
                  {b.heading && <b>{b.heading}</b>}
                  {b.description && <p>{b.description}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </AdminBox>

      {/* ---- Blocks ---- */}
      <AdminBox
        wide
        title="BLOCKS"
        side={loading ? '' : `${visible.length} showing${blocks.length > visible.length ? ` · ${blocks.length - visible.length} hidden` : ''}`}
        tip="Each block in the page's order — ↑ ↓ moves it. The heading and text save on their own when you click away. Hidden blocks stay here but don't show on the page."
      >
        {loading && <div className="ab-empty mono">Loading…</div>}

        {!loading && blocks.length === 0 && (
          <div className="ab-empty mono">Nothing on the About us page yet — add the first block above.</div>
        )}

        {!loading && blocks.length > 0 && visible.length === 0 && (
          <div className="ab-warn mono">Every block is hidden, so the About us page is empty right now.</div>
        )}

        <div className="about-list">
          {blocks.map((b, i) => (
            <div className={`about-card ${b.active ? '' : 'off'}`} key={b.id}>
              <label className="about-thumb" title="Change photo">
                <img src={imgUrl(b.image_url, { w: 320 })} alt="" />
                <span className="about-pos mono">{i + 1}</span>
                <span className="about-swap mono">Change photo</span>
                <input type="file" accept="image/*" onChange={(e) => changePhoto(b, e)} disabled={busy} hidden />
              </label>

              <div className="about-fields">
                <input
                  className="ab-input about-m-heading"
                  defaultValue={b.heading || ''}
                  placeholder="Heading"
                  maxLength={120}
                  onBlur={(e) => saveField(b, 'heading', e.target.value)}
                />
                <textarea
                  className="ab-input"
                  defaultValue={b.description || ''}
                  placeholder="Text"
                  rows={5}
                  onBlur={(e) => saveField(b, 'description', e.target.value)}
                />
              </div>

              <div className="about-tools mono">
                <button type="button" className="ab-tool" onClick={() => move(i, -1)} disabled={i === 0 || busy} aria-label="Up">↑</button>
                <button type="button" className="ab-tool" onClick={() => move(i, 1)} disabled={i === blocks.length - 1 || busy} aria-label="Down">↓</button>
                <button type="button" className={`ab-switch mono ${b.active ? 'on' : ''}`} onClick={() => toggleActive(b)} disabled={busy}>
                  {b.active ? 'Showing' : 'Hidden'}
                </button>
                {confirmId === b.id ? (
                  <span className="ab-confirm mono">
                    <button type="button" className="ab-yes" onClick={() => remove(b.id)}>Delete</button>
                    <button type="button" className="ab-no" onClick={() => setConfirmId(null)}>No</button>
                  </span>
                ) : (
                  <button type="button" className="ab-tool danger" onClick={() => setConfirmId(b.id)} aria-label="Delete block">
                    <IconX width="12" height="12" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </AdminBox>
    </div>
  )
}
