import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { cld, uploadImage } from '../lib/cloudinary.js'
import { saveProduct, deleteProduct } from '../lib/admin.js'
import { IconX } from './Icons.jsx'
import { stockForSizes, stockMap } from '../lib/stock.js'
import { sendRestockAlert } from '../lib/email.js'
import './product-form.css'

const BLANK = {
  id: '',
  sku: '',
  name: '',
  variant: '',
  price: '',
  cost: '',
  drop: 'DROP 02',
  category: 'T-SHIRTS',
  isNew: false,
  featured: false,
  images: [],
  description: '',
  sizes: ['S', 'M', 'L', 'XL'],
  sizesOut: [],
  stock: { S: 0, M: 0, L: 0, XL: 0 },
  details: '',
  sizeChart: null,
  colourGroup: '',
}

// Rows come from the DB in snake_case; the form works in the storefront's shape.
function fromRow(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    variant: row.variant,
    price: String(row.price),
    cost: row.cost != null ? String(row.cost) : '',
    drop: row.drop_name,
    category: row.category || '',
    isNew: row.is_new,
    featured: row.featured,
    images: row.images ?? [],
    description: row.description ?? '',
    sizes: row.sizes ?? [],
    sizesOut: row.sizes_out ?? [],
    stock: row.stock ?? null,
    details: row.details ?? '',
    sizeChart: row.size_chart ?? null,
    colourGroup: row.colour_group ?? '',
  }
}

function blankChart(sizes) {
  const columns = sizes.length > 0 ? sizes : ['S', 'M', 'L', 'XL']
  return {
    columns,
    rows: [{ label: 'CHEST', values: columns.map(() => '') }],
    notes: ['Measured flat, in centimetres'],
  }
}

export default function ProductForm({ existing, categories = [], onDone, onCancel }) {
  const isNewRecord = !existing
  const [p, setP] = useState(existing ? fromRow(existing) : BLANK)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const fileRef = useRef(null)

  // A product either keeps counts or it doesn't; the form shows one of two
  // states rather than a checkbox plus a dead set of inputs.
  const tracking = stockMap(p) !== null

  function set(field, value) {
    setP((prev) => ({ ...prev, [field]: value }))
  }

  // Stock is keyed by size, so editing the size list has to carry the counts
  // across with it: sizes that stay keep their number, a new size starts at 0,
  // and a removed size drops out instead of lingering in the row.
  function setSizes(csv) {
    const sizes = csv.split(',').map((s) => s.trim()).filter(Boolean)

    setP((prev) => ({
      ...prev,
      sizes,
      stock: stockMap(prev) ? stockForSizes(prev, sizes) : prev.stock,
    }))
  }

  function setStock(size, value) {
    const n = Math.max(0, Math.trunc(Number(value) || 0))
    setP((prev) => ({ ...prev, stock: { ...(prev.stock || {}), [size]: n } }))
  }

  function startTracking() {
    setP((prev) => ({ ...prev, stock: stockForSizes(prev, prev.sizes) }))
  }

  function stopTracking() {
    setP((prev) => ({ ...prev, stock: null }))
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

  function updateChart(fn) {
    setP((prev) => ({ ...prev, sizeChart: fn(prev.sizeChart) }))
  }

  // Changing the columns has to resize every row in step, otherwise a row keeps
  // values that no longer line up with a heading.
  function setChartColumns(csv) {
    const columns = csv.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    updateChart((chart) => ({
      ...chart,
      columns,
      rows: chart.rows.map((r) => ({
        ...r,
        values: columns.map((_, i) => r.values[i] ?? ''),
      })),
    }))
  }

  function setChartCell(rowIndex, colIndex, value) {
    updateChart((chart) => ({
      ...chart,
      rows: chart.rows.map((r, i) =>
        i !== rowIndex ? r : { ...r, values: r.values.map((v, j) => (j === colIndex ? value : v)) }
      ),
    }))
  }

  function setChartRowLabel(rowIndex, label) {
    updateChart((chart) => ({
      ...chart,
      rows: chart.rows.map((r, i) => (i === rowIndex ? { ...r, label } : r)),
    }))
  }

  function addChartRow() {
    updateChart((chart) => ({
      ...chart,
      rows: [...chart.rows, { label: '', values: chart.columns.map(() => '') }],
    }))
  }

  function removeChartRow(rowIndex) {
    updateChart((chart) => ({
      ...chart,
      rows: chart.rows.filter((_, i) => i !== rowIndex),
    }))
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

    if (saveError) {
      setSaving(false)
      setError(
        saveError.message?.includes('duplicate')
          ? 'That product ID already exists — pick another.'
          : "Couldn't save. Check your connection and try again."
      )
      return
    }

    // Restocking is the moment the wishlist is for: any size that was at 0 and
    // now isn't gets its waiting list mailed. Done after the save so nobody is
    // told a size is back before it actually is, and never allowed to fail the
    // save — the admin panel can always send again by hand.
    const before = stockMap({ stock: existing?.stock ?? null }) || {}
    const after = stockMap(p) || {}

    // A brand new product has nothing before it and nobody waiting, so there
    // is nothing to announce.
    const restocked = isNewRecord
      ? []
      : Object.keys(after).filter(
          (size) => (after[size] ?? 0) > 0 && (before[size] ?? 0) === 0
        )

    for (const size of restocked) {
      await sendRestockAlert(p.id.trim(), size)
    }

    setSaving(false)

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
          <span className="mono">COLOUR GROUP</span>
          <input
            value={p.colourGroup}
            onChange={(e) => set('colourGroup', e.target.value.toUpperCase())}
            placeholder="VARSITY-JACKET"
          />
          <em className="pf-hint mono">
            Give every colour of the same piece this exact tag and they'll list
            each other on the product page. Leave empty if it comes in one colour.
          </em>
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
          <span className="mono">COST (৳, OPTIONAL)</span>
          <input
            type="number"
            value={p.cost ?? ''}
            onChange={(e) => set('cost', e.target.value)}
            placeholder="What it cost to make or buy in"
          />
          <em className="pf-hint mono">For the margin panel — never shown to customers.</em>
        </label>

        <label className="pf-field">
          <span className="mono">DROP</span>
          <input value={p.drop} onChange={(e) => set('drop', e.target.value)} placeholder="DROP 02" />
        </label>

        <div className="pf-field pf-cat-field">
          <span className="mono">CATEGORY</span>

          {/* Picking from existing names instead of typing keeps the shop menu
              clean — a typo like T-SHIRT vs T-SHIRTS would otherwise split one
              category into two. */}
          <div className="pf-cats">
            {[...new Set([...categories, p.category].filter(Boolean))].sort().map((c) => (
              <button
                type="button"
                key={c}
                className={`pf-cat ${p.category === c ? 'on' : ''}`}
                onClick={() => set('category', c)}
              >
                <span className="pf-box" />
                {c}
              </button>
            ))}

            {!addingCategory && (
              <button
                type="button"
                className="pf-cat new"
                onClick={() => setAddingCategory(true)}
              >
                + New category
              </button>
            )}
          </div>

          {addingCategory && (
            <div className="pf-newcat">
              <input
                className="mono"
                autoFocus
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value.toUpperCase())}
                placeholder="E.G. TRACKSUITS"
              />
              <button
                type="button"
                className="pf-newcat-add mono"
                onClick={() => {
                  if (!newCategory.trim()) return
                  set('category', newCategory.trim())
                  setNewCategory('')
                  setAddingCategory(false)
                }}
              >
                Use
              </button>
              <button
                type="button"
                className="pf-ghost mono"
                onClick={() => {
                  setNewCategory('')
                  setAddingCategory(false)
                }}
              >
                Cancel
              </button>
            </div>
          )}

          <em className="pf-hint mono">
            The product shows under this category in the shop menu.
          </em>
        </div>
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

      <label className="pf-field">
        <span className="mono">DETAILS</span>
        <textarea
          rows={6}
          value={p.details}
          onChange={(e) => set('details', e.target.value)}
          placeholder={'Oversized fit\nChain stitch embroidery\nBranded metal zipper\nShell: 55% wool, 45% polyester'}
        />
        <em className="pf-hint mono">
          One line per bullet. These sit behind the DETAILS button on the product
          page — leave it empty and that button doesn't show at all.
        </em>
      </label>

      {/* ---- Sizes ---- */}
      <div className="pf-grid">
        <label className="pf-field">
          <span className="mono">SIZES AVAILABLE</span>
          <input
            value={p.sizes.join(', ')}
            onChange={(e) => setSizes(e.target.value)}
            placeholder="S, M, L, XL"
          />
          <em className="pf-hint mono">Comma separated.</em>
        </label>

        <label className="pf-field">
          <span className="mono">SIZES OFF THE PAGE</span>
          <input
            value={p.sizesOut.join(', ')}
            onChange={(e) =>
              set('sizesOut', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
            }
            placeholder="XXL"
          />
          <em className="pf-hint mono">
            Manual override — struck through whatever the count says. A size that
            runs out sells out on its own.
          </em>
        </label>
      </div>

      {/* ---- Stock ---- */}
      <div className="pf-label mono">STOCK</div>
      <div className="pf-note mono">
        Pieces left in each size. Every order takes its own off the count, and a
        size that hits 0 goes sold out on the product page by itself. Turn
        counting off and this product sells with no limit, as it did before
        stock existed.
      </div>

      {p.sizes.length === 0 ? (
        <div className="pf-note mono">Add a size above to count stock for it.</div>
      ) : !tracking ? (
        <button type="button" className="pf-add mono" onClick={startTracking}>
          + Count stock for this product
        </button>
      ) : (
        <>
          <div className="pf-stock">
            {p.sizes.map((size) => {
              const count = Number(p.stock?.[size] ?? 0)

              return (
                <label className="pf-stock-cell" key={size}>
                  <span className="mono">{size}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    className={count === 0 ? 'zero' : ''}
                    value={String(count)}
                    onChange={(e) => setStock(size, e.target.value)}
                  />
                </label>
              )
            })}
          </div>
          <button type="button" className="pf-remove mono" onClick={stopTracking}>
            Stop counting stock
          </button>
        </>
      )}

      {/* ---- Size chart ---- */}
      <div className="pf-label mono">SIZE CHART</div>
      <div className="pf-note mono">
        Each product carries its own chart — a jacket and a tee don't measure the
        same way. Without one, the SIZE CHART button stays hidden on the page.
      </div>

      {!p.sizeChart ? (
        <button
          type="button"
          className="pf-chart-add mono"
          onClick={() => set('sizeChart', blankChart(p.sizes))}
        >
          + Add a size chart
        </button>
      ) : (
        <div className="pf-chart">
          <label className="pf-field">
            <span className="mono">COLUMNS</span>
            <input
              className="mono"
              value={p.sizeChart.columns.join(', ')}
              onChange={(e) => setChartColumns(e.target.value)}
              placeholder="S, M, L, XL"
            />
            <em className="pf-hint mono">Comma separated — usually the sizes you sell.</em>
          </label>

          <div className="pf-chart-grid">
            <div
              className="pf-chart-row head mono"
              style={{ gridTemplateColumns: `150px repeat(${p.sizeChart.columns.length}, 1fr) 30px` }}
            >
              <span>MEASUREMENT</span>
              {p.sizeChart.columns.map((c) => (
                <span key={c}>{c}</span>
              ))}
              <span />
            </div>

            {p.sizeChart.rows.map((row, ri) => (
              <div
                className="pf-chart-row"
                key={ri}
                style={{ gridTemplateColumns: `150px repeat(${p.sizeChart.columns.length}, 1fr) 30px` }}
              >
                <input
                  className="mono"
                  value={row.label}
                  onChange={(e) => setChartRowLabel(ri, e.target.value.toUpperCase())}
                  placeholder="CHEST"
                />
                {p.sizeChart.columns.map((c, ci) => (
                  <input
                    key={c}
                    className="mono"
                    value={row.values[ci] ?? ''}
                    onChange={(e) => setChartCell(ri, ci, e.target.value)}
                    placeholder="—"
                  />
                ))}
                <button
                  type="button"
                  className="pf-chart-x"
                  onClick={() => removeChartRow(ri)}
                  title="Remove row"
                >
                  <IconX width="12" height="12" />
                </button>
              </div>
            ))}
          </div>

          <div className="pf-chart-actions">
            <button type="button" className="pf-chart-add mono" onClick={addChartRow}>
              + Add measurement
            </button>
            <button
              type="button"
              className="pf-ghost danger mono"
              onClick={() => set('sizeChart', null)}
            >
              Remove chart
            </button>
          </div>

          <label className="pf-field">
            <span className="mono">CHART NOTES</span>
            <textarea
              rows={3}
              value={(p.sizeChart.notes || []).join('\n')}
              onChange={(e) =>
                updateChart((chart) => ({
                  ...chart,
                  notes: e.target.value.split('\n'),
                }))
              }
              placeholder={'Measured flat, in centimetres\nChest measured as circumference'}
            />
            <em className="pf-hint mono">One line per note, shown under the chart.</em>
          </label>
        </div>
      )}

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
