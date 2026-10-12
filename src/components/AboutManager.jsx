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
import './about-manager.css'

export default function AboutManager() {
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newHeading, setNewHeading] = useState('')
  const [newText, setNewText] = useState('')
  const [confirmId, setConfirmId] = useState(null)

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

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!newHeading.trim() && !newText.trim()) {
      setError('Write the heading and text that go next to the photo first.')
      return
    }

    setBusy(true)
    setError('')

    try {
      const url = await uploadImage(file, supabase, 'about')
      const { error: createError } = await createAboutBlock({
        imageUrl: url,
        heading: newHeading.trim(),
        description: newText.trim(),
        sortOrder: blocks.length,
      })
      if (createError) throw new Error('Could not save the block')
      setNewHeading('')
      setNewText('')
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

  const visibleCount = blocks.filter((b) => b.active).length

  return (
    <section className="panel">
      <div className="panel-note mono" style={{ marginBottom: '18px' }}>
        This builds the About us page. Each block is one photo with a heading
        and text beside it (photo on the left, words on the right on a computer;
        stacked on a phone) — add as many as you want and move the order with
        the arrows. Hidden blocks stay here but don't show on the page.
      </div>

      {error && <div className="err-banner mono">{error}</div>}

      <div className="am-add">
        <div className="am-fields">
          <input
            className="am-text-input am-heading-input"
            placeholder="Heading — e.g. Made in Dhaka, worn everywhere"
            value={newHeading}
            onChange={(e) => setNewHeading(e.target.value)}
            maxLength={120}
          />
          <textarea
            className="am-text-input"
            placeholder="The text under the heading… (an empty line starts a new paragraph)"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            rows={4}
          />
        </div>
        <label className={`am-upload mono ${busy ? 'busy' : ''}`}>
          {busy ? 'Working…' : '+ Upload photo'}
          <input type="file" accept="image/*" onChange={handleUpload} disabled={busy} />
        </label>
      </div>

      <div className="am-size-note mono">
        <strong>Photo size:</strong> around 1600 px wide works well. The page
        shows photos at their own shape rather than cropping them, so portrait
        and landscape shots both sit fine.
      </div>

      {loading && <div className="empty mono">Loading…</div>}

      {!loading && blocks.length === 0 && (
        <div className="empty mono">
          Nothing on the About us page yet. Add a photo above — until then the
          page tells visitors the story is coming.
        </div>
      )}

      {!loading && blocks.length > 0 && visibleCount === 0 && (
        <div className="am-warn mono">
          Every block is hidden, so the About us page is empty right now.
        </div>
      )}

      <div className="am-list">
        {blocks.map((b, i) => (
          <div className={`am-row ${b.active ? '' : 'off'}`} key={b.id}>
            <div className="am-thumb">
              <img src={imgUrl(b.image_url, { w: 320 })} alt="" />
            </div>

            <div className="am-fields">
              <input
                className="am-text am-heading"
                defaultValue={b.heading || ''}
                placeholder="Heading"
                maxLength={120}
                onBlur={(e) => saveField(b, 'heading', e.target.value)}
              />
              <textarea
                className="am-text"
                defaultValue={b.description || ''}
                placeholder="Text"
                rows={5}
                onBlur={(e) => saveField(b, 'description', e.target.value)}
              />
            </div>

            <div className="am-side">
              <div className="am-order mono">
                <button onClick={() => move(i, -1)} disabled={i === 0 || busy}>←</button>
                <span>{i + 1}</span>
                <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1 || busy}>→</button>
              </div>

              <button className="am-toggle mono" onClick={() => toggleActive(b)} disabled={busy}>
                {b.active ? 'Visible' : 'Hidden'}
              </button>

              {confirmId === b.id ? (
                <div className="am-confirm mono">
                  <button className="am-danger" onClick={() => remove(b.id)}>Delete</button>
                  <button className="am-ghost" onClick={() => setConfirmId(null)}>No</button>
                </div>
              ) : (
                <button
                  className="am-x mono"
                  onClick={() => setConfirmId(b.id)}
                  title="Delete block"
                >
                  <IconX width="13" height="13" /> Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
