import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { cld, uploadImage } from '../lib/cloudinary.js'
import { saveProduct, deleteProduct } from '../lib/admin.js'
import { IconX } from './Icons.jsx'
import './product-form.css'

const BLANK = {
  id: '',
  sku: '',
  name: '',
  variant: '',
  price: '',
  drop: 'DROP 02',
  category: 'T-SHIRTS',
  isNew: false,
  featured: false,
  images: [],
  description: '',
  sizes: ['S', 'M', 'L', 'XL'],
  sizesOut: [],
  specs: [
    { k: 'FABRIC', v: '' },
    { k: 'FIT', v: '' },
    { k: 'CARE', v: 'Machine wash cold' },
    { k: 'ORIGIN', v: 'Made in Bangladesh' },
    { k: 'DELIVERY', v: 'Cash on delivery, 2–5 days' },
  ],
}

// Rows come from the DB in snake_case; the form works in the storefront's shape.
function fromRow(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    variant: row.variant,
    price: String(row.price),
    drop: row.drop_name,
    category: row.category || '',
    isNew: row.is_new,
    featured: row.featured,
    images: row.images ?? [],
    description: row.description ?? '',
    sizes: row.sizes ?? [],
    sizesOut: row.sizes_out ?? [],
    specs: row.specs ?? [],
  }
}

export default function ProductForm({ existing, onDone, onCancel }) {
  const isNewRecord = !existing
  const [p, setP] = useState(existing ? fromRow(existing) : BLANK)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef(null)

  function set(field, value) {
    setP((prev) => ({ ...prev, [field]: value }))
  }

  async function handleFiles(e) {
    const files = [...e.target.files]
    if (files.length === 0) return

    setUploading(true)
    setError('')

    try {
      // Sequential rather than parallel: each upload needs its own signature,
      // and a burst of them is more likely to trip Cloudinary's rate limit.
      const urls = []
      for (const file of files) {
        urls.push(await uploadImage(file, supabase))
      }
      setP((prev) => ({ ...prev, images: [...prev.images, ...urls] }))
    } catch (err) {
      setError(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function removeImage(url) {
    setP((prev) => ({ ...prev, images: prev.images.filter((i) => i !== url) }))
  }

  function moveImage(index, dir) {
    setP((prev) => {
      const next = [...prev.images]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...prev, images: next }
    })
  }

  function setSpec(i, key, value) {
    setP((prev) => {
      const specs = [...prev.specs]
      specs[i] = { ...specs[i], [key]: value }
      return { ...prev, specs }
    })
  }

  function validate() {
    if (!p.id.trim()) return 'Product ID is required (e.g. prd-050)'
    if (!/^[a-z0-9-]+$/.test(p.id.trim())) return 'ID can only use lowercase letters, numbers and hyphens'
    if (!p.name.trim()) return 'Name is required'
    if (!p.sku.trim()) return 'SKU is required'
    if (!p.variant.trim()) return 'Variant (colour) is required'
    if (!p.price || Number(p.price) <= 0) return 'Enter a price above 0'
    if (p.images.length === 0) return 'Add at least one image'
    if (p.sizes.length === 0) return 'Add at least one size'
    if (!p.category.trim()) return 'Category is required (e.g. T-SHIRTS)'
    return ''
  }

  async function handleSave() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    setSaving(true)
    setError('')

    const { error: saveError } = await saveProduct(
      { ...p, id: p.id.trim(), price: Number(p.price) },
      isNewRecord
    )

    setSaving(false)

    if (saveError) {
      setError(
        saveError.message?.includes('duplicate')
          ? 'That product ID already exists — pick another.'
          : "Couldn't save. Check your connection and try again."
      )
      return
    }

    onDone()
  }

  async function handleDelete() {
    setSaving(true)
    const { error: delError } = await deleteProduct(p.id)
    setSaving(false)

    if (delError) {
      setError("Couldn't delete that product.")
      return
    }

    onDone()
  }

  return (
    <div className="pform">
      <div className="pform-head">
        <h3 className="display">{isNewRecord ? 'New product' : `Edit ${p.name}`}</h3>
        <button className="pf-ghost mono" onClick={onCancel}>Cancel</button>
      </div>

      {error && <div className="pf-error mono">{error}</div>}

      {/* ---- Images ---- */}
      <div className="pf-label mono">IMAGES</div>
      <div className="pf-note mono">
        First image is the one shown on the shop grid. Upload goes to Cloudinary.
      </div>

      <div className="pf-images">
        {p.images.map((url, i) => (
          <div className="pf-img" key={url}>
            <img src={cld(url, { w: 200 })} alt="" />
            <button className="pf-img-x" onClick={() => removeImage(url)} title="Remove">
              <IconX width="13" height="13" />
            </button>
            <div className="pf-img-move mono">
              <button onClick={() => moveImage(i, -1)} disabled={i === 0}>←</button>
              <span>{i + 1}</span>
              <button onClick={() => moveImage(i, 1)} disabled={i === p.images.length - 1}>→</button>
            </div>
          </div>
        ))}

        <label className={`pf-upload mono ${uploading ? 'busy' : ''}`}>
          {uploading ? 'Uploading…' : '+ Add images'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFiles}
            disabled={uploading}
          />
        </label>
      </div>

      {/* ---- Basics ---- */}
      <div className="pf-grid">
        <label className="pf-field">
          <span className="mono">PRODUCT ID</span>
          <input
            value={p.id}
            onChange={(e) => set('id', e.target.value)}
            placeholder="prd-050"
            disabled={!isNewRecord}
          />
          {!isNewRecord && <em className="pf-hint mono">ID can't be changed after creation.</em>}
        </label>

        <label className="pf-field">
          <span className="mono">SKU</span>
          <input value={p.sku} onChange={(e) => set('sku', e.target.value)} placeholder="PRD-050 · TEE" />
        </label>

        <label className="pf-field">
          <span className="mono">NAME</span>
          <input value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="Heavyweight Tee" />
        </label>

        <label className="pf-field">
          <span className="mono">VARIANT / COLOUR</span>
          <input value={p.variant} onChange={(e) => set('variant', e.target.value)} placeholder="Bone White" />
        </label>

        <label className="pf-field">
          <span className="mono">PRICE (৳)</span>
          <input
            type="number"
            value={p.price}
            onChange={(e) => set('price', e.target.value)}
            placeholder="1200"
          />
        </label>

        <label className="pf-field">
          <span className="mono">DROP</span>
          <input value={p.drop} onChange={(e) => set('drop', e.target.value)} placeholder="DROP 02" />
        </label>

        <label className="pf-field">
          <span className="mono">CATEGORY</span>
          <input
            value={p.category}
            onChange={(e) => set('category', e.target.value.toUpperCase())}
            placeholder="T-SHIRTS"
          />
          <em className="pf-hint mono">Shows in the shop menu. Reuse exact names to group items.</em>
        </label>
      </div>

      <label className="pf-field">
        <span className="mono">DESCRIPTION</span>
        <textarea
          rows={3}
          value={p.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Fabric, fit, what makes it worth buying."
        />
      </label>

      {/* ---- Sizes ---- */}
      <div className="pf-grid">
        <label className="pf-field">
          <span className="mono">SIZES AVAILABLE</span>
          <input
            value={p.sizes.join(', ')}
            onChange={(e) =>
              set('sizes', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
            }
            placeholder="S, M, L, XL"
          />
          <em className="pf-hint mono">Comma separated.</em>
        </label>

        <label className="pf-field">
          <span className="mono">SIZES SOLD OUT</span>
          <input
            value={p.sizesOut.join(', ')}
            onChange={(e) =>
              set('sizesOut', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
            }
            placeholder="XXL"
          />
          <em className="pf-hint mono">Shown struck through, can't be ordered.</em>
        </label>
      </div>

      {/* ---- Flags ---- */}
      <div className="pf-flags">
        <label className="pf-check mono">
          <input type="checkbox" checked={p.isNew} onChange={(e) => set('isNew', e.target.checked)} />
          Show NEW badge
        </label>
        <label className="pf-check mono">
          <input
            type="checkbox"
            checked={p.featured}
            onChange={(e) => set('featured', e.target.checked)}
          />
          Feature on shop grid (large tile)
        </label>
      </div>

      {/* ---- Specs ---- */}
      <div className="pf-label mono">SPEC TABLE</div>
      {p.specs.map((row, i) => (
        <div className="pf-spec" key={i}>
          <input
            className="mono"
            value={row.k}
            onChange={(e) => setSpec(i, 'k', e.target.value)}
            placeholder="FABRIC"
          />
          <input
            value={row.v}
            onChange={(e) => setSpec(i, 'v', e.target.value)}
            placeholder="100% cotton, 220gsm"
          />
        </div>
      ))}

      {/* ---- Actions ---- */}
      <div className="pf-actions">
        <button className="pf-save mono" onClick={handleSave} disabled={saving || uploading}>
          {saving ? 'Saving…' : isNewRecord ? 'Create product' : 'Save changes'}
        </button>

        {!isNewRecord && (
          confirmDelete ? (
            <div className="pf-confirm mono">
              <span>Delete permanently?</span>
              <button className="pf-danger" onClick={handleDelete} disabled={saving}>Yes, delete</button>
              <button className="pf-ghost" onClick={() => setConfirmDelete(false)}>No</button>
            </div>
          ) : (
            <button className="pf-ghost danger mono" onClick={() => setConfirmDelete(true)}>
              Delete product
            </button>
          )
        )}
      </div>
    </div>
  )
}
