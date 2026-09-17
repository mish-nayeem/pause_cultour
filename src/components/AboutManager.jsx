import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { cld, uploadImage } from '../lib/cloudinary.js'
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

    if (!newText.trim()) {
      setError('Write the text that goes under the photo first.')
      return
    }

    setBusy(true)
    setError('')

    try {
      const url = await uploadImage(file, supabase)
      const { error: createError } = await createAboutBlock({
        imageUrl: url,
        description: newText.trim(),
        sortOrder: blocks.length,
      })
      if (createError) throw new Error('Could not save the block')
      setNewText('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveText(block, description) {
    if (description.trim() === (block.description || '')) return
    setBusy(true)
    await updateAboutBlock(block.id, { description: description.trim() })
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
        This builds the About us page. Each block is one photo with your text
        underneath it — add as many as you want and drag the order around with
        the arrows. Hidden blocks stay here but don't show on the page.
      </div>

      {error && <div className="err-banner mono">{error}</div>}

      <div className="am-add">
        <textarea
          className="am-text-input"
          placeholder="The text that goes under this photo…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          rows={3}
        />
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
              <img src={cld(b.image_url, { w: 320 })} alt="" />
            </div>

            <textarea
              className="am-text"
              defaultValue={b.description || ''}
              rows={4}
              onBlur={(e) => saveText(b, e.target.value)}
            />

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
