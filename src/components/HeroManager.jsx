import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { cld, uploadImage } from '../lib/cloudinary.js'
import {
  fetchAllHeroSlides,
  createHeroSlide,
  updateHeroSlide,
  deleteHeroSlide,
  reorderHeroSlides,
} from '../lib/hero.js'
import { IconX } from './Icons.jsx'
import './hero-manager.css'

export default function HeroManager() {
  const [slides, setSlides] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [confirmId, setConfirmId] = useState(null)

  async function load() {
    setLoading(true)
    const { slides, error } = await fetchAllHeroSlides()
    if (error) setError("Couldn't load hero slides. Did you run the hero SQL?")
    setSlides(slides)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!newLabel.trim()) {
      setError('Type a label first — it shows on the hero.')
      return
    }

    setBusy(true)
    setError('')

    try {
      const url = await uploadImage(file, supabase)
      const { error: createError } = await createHeroSlide({
        label: newLabel.trim().toUpperCase(),
        imageUrl: url,
        sortOrder: slides.length,
      })
      if (createError) throw new Error('Could not save the slide')
      setNewLabel('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function setFocus(slide, focus) {
    setBusy(true)
    await updateHeroSlide(slide.id, { focus })
    await load()
    setBusy(false)
  }

  async function toggleActive(slide) {
    setBusy(true)
    await updateHeroSlide(slide.id, { active: !slide.active })
    await load()
    setBusy(false)
  }

  async function rename(slide, label) {
    setBusy(true)
    await updateHeroSlide(slide.id, { label: label.trim().toUpperCase() })
    await load()
    setBusy(false)
  }

  async function move(index, dir) {
    const target = index + dir
    if (target < 0 || target >= slides.length) return

    const next = [...slides]
    ;[next[index], next[target]] = [next[target], next[index]]

    setSlides(next) // optimistic, so the list doesn't jump while saving
    setBusy(true)
    await reorderHeroSlides(next)
    await load()
    setBusy(false)
  }

  async function remove(id) {
    setBusy(true)
    await deleteHeroSlide(id)
    setConfirmId(null)
    await load()
    setBusy(false)
  }

  const activeCount = slides.filter((s) => s.active).length

  return (
    <section className="panel">
      <div className="panel-note mono" style={{ marginBottom: '18px' }}>
        These are the full-screen images on the homepage — they rotate every 5
        seconds. The label is just your own name for the slide; it isn't shown
        on the site. Hidden slides stay here but don't appear in the rotation.
      </div>

      {error && <div className="err-banner mono">{error}</div>}

      <div className="hm-add">
        <input
          className="hm-label-input mono"
          placeholder="Label, e.g. WINTER 26 DROP"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <label className={`hm-upload mono ${busy ? 'busy' : ''}`}>
          {busy ? 'Working…' : '+ Upload image'}
          <input type="file" accept="image/*" onChange={handleUpload} disabled={busy} />
        </label>
      </div>

      {/* Sits next to the upload button rather than in the intro text, so it's
          read at the moment the file is being chosen. */}
      <div className="hm-size-note mono">
        <strong>Image size:</strong> upload a wide landscape photo, around
        2400 × 1350 px (16:9). The hero fills the whole screen, so taller or
        narrower images will be cropped — use the "Keep …" setting on each
        slide to choose which part stays in frame.
      </div>

      {loading && <div className="empty mono">Loading…</div>}

      {!loading && slides.length === 0 && (
        <div className="empty mono">
          No hero slides yet. Add one above — until then the homepage shows a
          plain background.
        </div>
      )}

      {!loading && activeCount === 0 && slides.length > 0 && (
        <div className="hm-warn mono">
          Every slide is hidden, so the homepage hero is empty right now.
        </div>
      )}

      <div className="hm-list">
        {slides.map((s, i) => (
          <div className={`hm-row ${s.active ? '' : 'off'}`} key={s.id}>
            <div className="hm-thumb">
              <img src={cld(s.image_url, { w: 240 })} alt="" />
            </div>

            <input
              className="hm-name"
              defaultValue={s.label}
              onBlur={(e) => {
                if (e.target.value.trim().toUpperCase() !== s.label) rename(s, e.target.value)
              }}
            />

            <div className="hm-order mono">
              <button onClick={() => move(i, -1)} disabled={i === 0 || busy}>←</button>
              <span>{i + 1}</span>
              <button onClick={() => move(i, 1)} disabled={i === slides.length - 1 || busy}>→</button>
            </div>

            <select
              className="hm-focus mono"
              value={s.focus || 'center'}
              disabled={busy}
              onChange={(e) => setFocus(s, e.target.value)}
              title="Which part of the photo to keep when it's cropped"
            >
              <option value="top">Keep top</option>
              <option value="center">Keep middle</option>
              <option value="bottom">Keep bottom</option>
              <option value="left">Keep left</option>
              <option value="right">Keep right</option>
            </select>

            <button className="hm-toggle mono" onClick={() => toggleActive(s)} disabled={busy}>
              {s.active ? 'Visible' : 'Hidden'}
            </button>

            {confirmId === s.id ? (
              <div className="hm-confirm mono">
                <button className="hm-danger" onClick={() => remove(s.id)}>Delete</button>
                <button className="hm-ghost" onClick={() => setConfirmId(null)}>No</button>
              </div>
            ) : (
              <button className="hm-x" onClick={() => setConfirmId(s.id)} title="Delete slide">
                <IconX width="14" height="14" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
