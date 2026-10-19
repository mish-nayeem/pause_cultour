import { useRef, useState } from 'react'
import { toLocalInput, launchLabel } from '../lib/schedule.js'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl, uploadImage } from '../lib/images.js'
import { saveProduct, deleteProduct } from '../lib/admin.js'
import { IconX } from './Icons.jsx'
import { stockForSizes, stockMap } from '../lib/stock.js'
import { sendRestockAlert } from '../lib/email.js'
import { parseDetails, serializeDetails, mergeLabels, rememberedLabels, rememberLabels } from '../lib/details.js'
import InfoTip from './InfoTip.jsx'
import './product-form.css'

const BLANK = {
  id: '',
  sku: '',
  name: '',
  variant: '',
  price: '',
  cost: '',
  drop: '',
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
    publishAt: toLocalInput(row.publish_at),
  }
}

// The next id in the shop's own sequence: "pc" and seven digits
// (pc0000240, pc0000241, …), one past the highest pc-number already used —
// older short ones like pc239 count too, so the sequence carries on from
// them. Ids that don't follow the pattern (hand-typed names) are skipped.
export function nextProductId(ids) {
  const highest = ids.reduce((max, id) => {
    const m = /^pc(\d+)$/i.exec(String(id).trim())
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return 'pc' + String(highest + 1).padStart(7, '0')
}

function blankChart(sizes) {
  const columns = sizes.length > 0 ? sizes : ['S', 'M', 'L', 'XL']
  return {
    columns,
    rows: [{ label: 'CHEST', values: columns.map(() => '') }],
    notes: ['Measured flat, in centimetres'],
  }
}

// A new product starts with the boxes the last product had (Fabric, Fit…),
// values empty. A saved product starts with what it has.
function initialDetailRows(existing, labels) {
  if (existing) {
    const rows = parseDetails(existing.details)
    return rows.length > 0 ? rows : [{ label: '', value: '' }]
  }
  return labels.length > 0
    ? labels.map((label) => ({ label, value: '' }))
    : [{ label: '', value: '' }]
}

// Another colour of an existing piece: everything copied over — name, price,
// cost, drop, category, description, details, sizes, size chart, colour
// group, launch — except what differs per colour: its own id, colour name,
// photos and stock (every size back to 0).
function asNewColour(row, ids) {
  const base = fromRow(row)
  const counts = stockMap({ stock: row.stock ?? null })
  return {
    ...base,
    id: nextProductId(ids),
    sku: undefined,
    variant: '',
    images: [],
    sizesOut: [],
    stock: counts ? Object.fromEntries((base.sizes || []).map((s) => [s, 0])) : null,
  }
}

// Same name = same piece. The colour group a product should carry: the one
// it already has, else the group a same-named product already uses, else a
// tag made from the name when another product shares it. `relink` lists
// same-named products with no group yet, to be given this one.
function tagOf(name) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function colourLink(p, all) {
  const key = p.name.trim().toLowerCase()
  const same = all.filter((r) => String(r.id) !== String(p.id) && (r.name || '').trim().toLowerCase() === key)
  const own = (p.colourGroup || '').trim()
  if (own) return { group: own, relink: same.filter((r) => !r.colour_group).map((r) => r.id) }
  if (!same.length) return { group: '', relink: [] }
  const group = same.find((r) => r.colour_group)?.colour_group || tagOf(p.name)
  return { group, relink: same.filter((r) => !r.colour_group).map((r) => r.id) }
}

// The size chart a product in this category starts with: the one on the
// most recently added product of the same category — a tee starts with the
// last tee's chart, trousers with the last trousers' — or none.
function lastChartFor(category, all, exceptId) {
  const cat = (category || '').trim().toLowerCase()
  if (!cat) return null
  const match = all
    .filter((r) => String(r.id) !== String(exceptId) && (r.category || '').trim().toLowerCase() === cat && r.size_chart?.rows?.length)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0]
  return match ? JSON.parse(JSON.stringify(match.size_chart)) : null
}

// Sizes ticked on and off in the form, in this order, with their full names.
const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL']
const SIZE_NAMES = { XS: 'XS · Extra small', S: 'S · Small', M: 'M · Medium', L: 'L · Large', XL: 'XL · Extra large', XXL: 'XXL' }

function FieldLabel({ tip, children }) {
  return (
    <span className="pf-flabel mono">
      {children}
      {tip && <InfoTip>{tip}</InfoTip>}
    </span>
  )
}

// One box of the form: a title (with its ⓘ) and what goes in it.
function Box({ title, tip, wide = false, children }) {
  return (
    <section className={`pf-sec ${wide ? 'wide' : ''}`}>
      <div className="pf-sec-head">
        <span className="pf-sec-title mono">{title}</span>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      {children}
    </section>
  )
}

export default function ProductForm({ existing, copyFrom = null, allProducts = [], existingIds = [], categories = [], drops = [], initialDrop = '', initialPublishAt = '', detailLabels = [], startLabels = [], onDone, onCancel, onAddColour }) {
  const isNewRecord = !existing
  // A product added from Products → Collections starts in that collection.
  const [p, setP] = useState(() => (
    existing
      ? fromRow(existing)
      : copyFrom
        ? asNewColour(copyFrom, existingIds)
        : {
            ...BLANK,
            drop: initialDrop,
            publishAt: toLocalInput(initialPublishAt),
            id: nextProductId(existingIds),
            sizeChart: lastChartFor(BLANK.category, allProducts, null),
          }
  ))
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const fileRef = useRef(null)

  // The other colours this product will be shown with (same name), for the
  // OTHER COLOURS line.
  const otherColours = allProducts.filter((r) =>
    String(r.id) !== String(p.id) && p.name.trim() && (r.name || '').trim().toLowerCase() === p.name.trim().toLowerCase()
  )

  const knownLabels = mergeLabels(detailLabels, rememberedLabels())
  const [detailRows, setDetailRows] = useState(() => {
    const last = rememberedLabels()
    return initialDetailRows(existing || copyFrom, last.length ? last : startLabels)
  })

  // A product either keeps counts or it doesn't; the form shows one of two
  // states rather than a checkbox plus a dead set of inputs.
  const tracking = stockMap(p) !== null

  // The rows are the source of truth while editing; `details` is the text they
  // serialise to, kept in step so the save path stays the same as ever.
  function updateDetailRows(next) {
    setDetailRows(next)
    setP((prev) => ({ ...prev, details: serializeDetails(next) }))
  }

  function set(field, value) {
    setP((prev) => ({ ...prev, [field]: value }))
  }

  // Picking a category brings in that category's latest size chart (edit it
  // if this one differs); a category with no chart yet leaves it empty, so a
  // tee's chart never follows the product into trousers.
  function pickCategory(category) {
    setP((prev) => {
      if ((prev.category || '').trim().toLowerCase() === (category || '').trim().toLowerCase()) return { ...prev, category }
      return { ...prev, category, sizeChart: lastChartFor(category, allProducts, prev.id) }
    })
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

  // Sizes ticked on and off: the usual ones plus any this product (or this
  // session) added, in that order.
  const [addingSize, setAddingSize] = useState(false)
  const [newSize, setNewSize] = useState('')
  const [extraSizes, setExtraSizes] = useState(() => (p.sizes || []).filter((z) => !STANDARD_SIZES.includes(z)))
  const sizeChoices = [...STANDARD_SIZES, ...extraSizes.filter((z) => !STANDARD_SIZES.includes(z))]

  function toggleSize(z) {
    const on = p.sizes.includes(z)
    const next = on ? p.sizes.filter((x) => x !== z) : sizeChoices.filter((x) => x === z || p.sizes.includes(x))
    setSizes(next.join(', '))
    if (on && p.sizesOut.includes(z)) set('sizesOut', p.sizesOut.filter((x) => x !== z))
  }

  function addSize() {
    const z = newSize.trim().toUpperCase()
    if (!z) return
    if (!sizeChoices.includes(z)) setExtraSizes((prev) => [...prev, z])
    if (!p.sizes.includes(z)) setSizes([...p.sizes, z].join(', '))
    setNewSize('')
    setAddingSize(false)
  }

  function toggleSizeOut(z) {
    set('sizesOut', p.sizesOut.includes(z) ? p.sizesOut.filter((x) => x !== z) : [...p.sizesOut, z])
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
      // One at a time, so the photos land in the order they were picked.
      const urls = []
      for (const file of files) {
        urls.push(await uploadImage(file, supabase, 'products'))
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

  // Puts a photo first: the one the shop card shows, with the rest after it
  // in the same order.
  function makeMain(index) {
    setP((prev) => {
      const next = [...prev.images]
      const [picked] = next.splice(index, 1)
      return { ...prev, images: [picked, ...next] }
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
    if (!p.id.trim()) return 'Product ID is missing — reload the page and try again'
    if (!p.name.trim()) return 'Name is required'
    if (!p.variant.trim()) return copyFrom ? "Give this colour a name (Variant / colour), e.g. Blue" : 'Variant (colour) is required'
    if (copyFrom && p.variant.trim().toLowerCase() === (copyFrom.variant || '').trim().toLowerCase()) {
      return `${copyFrom.name} already comes in ${copyFrom.variant} — give this colour its own name`
    }
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

    rememberLabels(detailRows.map((row) => row.label))

    // SKU isn't typed any more: a new product takes its id in capitals
    // (PC240), which is what the product page and cart print as its code.
    // An older product keeps whatever SKU it already had.
    const id = p.id.trim()
    const link = colourLink({ ...p, id }, allProducts)
    const { error: saveError } = await saveProduct(
      { ...p, id, colourGroup: link.group, sku: p.sku?.trim() || id.toUpperCase(), price: Number(p.price) },
      isNewRecord
    )

    // The same-named products that weren't linked yet join this one's group.
    if (!saveError && link.group && link.relink.length) {
      await supabase.from('products').update({ colour_group: link.group }).in('id', link.relink)
    }

    if (saveError) {
      setSaving(false)
      setError(
        saveError.message?.includes('duplicate')
          ? 'Another product just took this ID — close the form and add it again.'
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
        <h3 className="display">
          {copyFrom ? `New colour — ${copyFrom.name}` : isNewRecord ? 'New product' : `Edit ${p.name}`}
        </h3>
        <div className="pf-head-actions">
          {/* Same piece, another colour: a new product with all of this one's
              details already filled in, linked to it on the product page. */}
          {!isNewRecord && onAddColour && (
            <button type="button" className="pf-add-colour mono" onClick={() => onAddColour(existing)}>
              + Add another colour
            </button>
          )}
          <button className="pf-ghost mono" onClick={onCancel}>Cancel</button>
        </div>
      </div>

      {copyFrom && (
        <div className="pf-copy-note mono">
          Everything is copied from <strong>{copyFrom.name}{copyFrom.variant ? ` — ${copyFrom.variant}` : ''}</strong>.
          Just add this colour's <strong>name</strong> (Variant / colour), its <strong>photos</strong> and
          its <strong>stock</strong>. Both colours show each other on the product page.
        </div>
      )}

      {error && <div className="pf-error mono">{error}</div>}

      {/* Every part of the form is its own box — three to a row on a
          desktop, one under the other on a phone. The longer explanations
          sit behind an ⓘ beside each title. */}
      <div className="pf-secs">
        {/* ---- Images ---- */}
        <Box
          title="IMAGES"
          wide
          tip={<>The <strong>MAIN</strong> photo is the one on the shop card and first on the product page; the rest follow in this order. Use ← → to reorder, or "Set as main" on any photo.</>}
        >
          <div className="pf-images">
            {p.images.map((url, i) => (
              <div className="pf-img" key={url}>
                <img src={imgUrl(url, { w: 200 })} alt="" />
                {i === 0 ? (
                  <span className="pf-img-main mono">MAIN</span>
                ) : (
                  <button type="button" className="pf-img-setmain mono" onClick={() => makeMain(i)}>Set as main</button>
                )}
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
        </Box>

        {/* ---- ID, price, cost ---- */}
        <Box title="CODE & PRICE">
          <label className="pf-field">
            <FieldLabel
              tip={isNewRecord
                ? 'Given automatically — the next number after your last product. Also used as its code (SKU).'
                : "ID can't be changed after creation. It's also the product's code (SKU)."}
            >
              PRODUCT ID
            </FieldLabel>
            <input value={p.id} disabled readOnly />
          </label>

          <label className="pf-field">
            <FieldLabel>PRICE (৳)</FieldLabel>
            <input
              type="number"
              value={p.price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="1200"
            />
          </label>

          <label className="pf-field">
            <FieldLabel tip="What it cost to make or buy in. Used for the Cost & margin panel — never shown to customers.">
              COST (৳, OPTIONAL)
            </FieldLabel>
            <input
              type="number"
              value={p.cost ?? ''}
              onChange={(e) => set('cost', e.target.value)}
              placeholder="What it cost you"
            />
          </label>
        </Box>

        {/* ---- Name & colour ---- */}
        <Box title="NAME & COLOUR">
          <label className="pf-field">
            <FieldLabel>PRODUCT NAME</FieldLabel>
            <input value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="Heavyweight Tee" />
          </label>

          <label className="pf-field">
            <FieldLabel>VARIANT / COLOUR</FieldLabel>
            <input value={p.variant} onChange={(e) => set('variant', e.target.value)} placeholder="Bone White" />
          </label>

          {/* No colour-group box to fill in: products with the same name are
              colours of one piece and link up by themselves when saved. */}
          <div className="pf-field">
            <FieldLabel tip="Products with the same name are shown as colours of one piece: each colour its own card in the shop, and a colour picker on the product page. Use + Add another colour at the top, or give another product the same name.">
              OTHER COLOURS
            </FieldLabel>
            <div className="pf-colours mono">
              {otherColours.length ? otherColours.map((c) => c.variant || c.id).join(' · ') : 'None yet'}
            </div>
          </div>
        </Box>

        {/* ---- Collection / drop ---- */}
        <Box title="COLLECTION / DROP" tip="The collections made in Products → Collections. Picking one keeps the spelling the same as the menu and the lookbook — or type a new name.">
          {drops.length > 0 && (
            <div className="pf-cats">
              {[...new Set([...drops, p.drop].filter(Boolean))].map((d) => (
                <button
                  type="button"
                  key={d}
                  className={`pf-cat ${p.drop === d ? 'on' : ''}`}
                  onClick={() => set('drop', p.drop === d ? '' : d)}
                >
                  <span className="pf-box" />
                  {d}
                </button>
              ))}
            </div>
          )}
          <div className="pf-field">
            <input
              value={p.drop || ''}
              onChange={(e) => set('drop', e.target.value)}
              placeholder={drops.length ? 'Or type a name' : 'e.g. PAUSE UNIVERSITY'}
            />
          </div>
        </Box>

        {/* ---- Category ---- */}
        <Box title="CATEGORY" tip="The product shows under this category in the shop menu. Picking an existing one (rather than typing) keeps T-SHIRT and T-SHIRTS from splitting into two. Picking one also fills in the size chart from the last product in that category.">
          <div className="pf-cats">
            {[...new Set([...categories, p.category].filter(Boolean))].sort().map((c) => (
              <button
                type="button"
                key={c}
                className={`pf-cat ${p.category === c ? 'on' : ''}`}
                onClick={() => pickCategory(c)}
              >
                <span className="pf-box" />
                {c}
              </button>
            ))}

            {!addingCategory && (
              <button type="button" className="pf-cat new" onClick={() => setAddingCategory(true)}>
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
                  pickCategory(newCategory.trim())
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
        </Box>

        {/* ---- Description ---- */}
        <Box title="DESCRIPTION" tip="Shown on the product page under the price — fabric, fit, what makes it worth buying.">
          <div className="pf-field">
            <textarea
              rows={5}
              value={p.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Fabric, fit, what makes it worth buying."
            />
          </div>
        </Box>

        {/* ---- Details ---- */}
        <Box
          title="DETAILS"
          tip={<>Box name on the left (Fabric, Fit…), the detail on the right. Customers see only what's on the right — "Fabric | 100% cotton" shows as "100% cotton". Leave the right side empty and that row isn't shown. A new product starts with the last product's boxes; add one with + Add box, drop one with ×.</>}
        >
          <div className="pf-detail-grid">
            {detailRows.map((row, i) => (
              <div className="pf-detail-row" key={i}>
                <input
                  className="mono"
                  list="pf-detail-labels"
                  value={row.label}
                  onChange={(e) =>
                    updateDetailRows(detailRows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                  placeholder="Fabric"
                />
                <input
                  value={row.value}
                  onChange={(e) =>
                    updateDetailRows(detailRows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                  placeholder="100% cotton"
                />
                <button
                  type="button"
                  className="pf-chart-x"
                  onClick={() => {
                    const next = detailRows.filter((_, j) => j !== i)
                    updateDetailRows(next.length > 0 ? next : [{ label: '', value: '' }])
                  }}
                  title="Remove row"
                >
                  <IconX width="12" height="12" />
                </button>
              </div>
            ))}
          </div>

          <datalist id="pf-detail-labels">
            {knownLabels.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>

          <button
            type="button"
            className="pf-chart-add mono"
            onClick={() => updateDetailRows([...detailRows, { label: '', value: '' }])}
          >
            + Add box
          </button>
        </Box>

        {/* ---- Sizes ---- */}
        <Box title="SIZES AVAILABLE" tip="Tick the sizes this product comes in; + Add size for one that isn't listed. Under it, tick a size to strike it through on the page whatever the stock count says — a size that runs out sells out by itself.">
          <div className="pf-sizes">
            {sizeChoices.map((z) => (
              <button
                type="button"
                key={z}
                className={`pf-cat ${p.sizes.includes(z) ? 'on' : ''}`}
                onClick={() => toggleSize(z)}
              >
                <span className="pf-box" />
                {SIZE_NAMES[z] || z}
              </button>
            ))}
          </div>

          {addingSize ? (
            <div className="pf-newcat">
              <input
                className="mono"
                autoFocus
                value={newSize}
                onChange={(e) => setNewSize(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSize() } }}
                placeholder="E.G. 3XL, 32, FREE"
              />
              <button type="button" className="pf-newcat-add mono" onClick={addSize}>Add</button>
              <button type="button" className="pf-ghost mono" onClick={() => { setNewSize(''); setAddingSize(false) }}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="pf-chart-add mono" onClick={() => setAddingSize(true)}>
              + Add size
            </button>
          )}

          {p.sizes.length > 0 && (
            <div className="pf-field">
              <FieldLabel tip="Struck through on the product page whatever the count says — for a size you've put aside. A size that runs out sells out on its own.">
                STRUCK THROUGH ON THE PAGE
              </FieldLabel>
              <div className="pf-sizes">
                {p.sizes.map((z) => (
                  <button
                    type="button"
                    key={z}
                    className={`pf-cat off ${p.sizesOut.includes(z) ? 'on' : ''}`}
                    onClick={() => toggleSizeOut(z)}
                  >
                    <span className="pf-box" />
                    {z}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Box>

        {/* ---- Stock ---- */}
        <Box title="STOCK" tip="Pieces left in each size. Every order takes its own off the count, and a size that hits 0 goes sold out on the product page by itself. Turn counting off and this product sells with no limit.">
          {p.sizes.length === 0 ? (
            <div className="pf-note mono">Tick a size first to count stock for it.</div>
          ) : !tracking ? (
            <button type="button" className="pf-add mono" onClick={startTracking}>
              + Count stock for this product
            </button>
          ) : (
            <>
              <div className="pf-stock-list">
                {p.sizes.map((size) => {
                  const count = Number(p.stock?.[size] ?? 0)
                  return (
                    <label className="pf-stock-line" key={size}>
                      <span className="mono">{SIZE_NAMES[size] || size}</span>
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
              <div className="pf-stock-total mono">
                Total {p.sizes.reduce((n, z) => n + Number(p.stock?.[z] ?? 0), 0)} pieces
              </div>
              <button type="button" className="pf-remove mono" onClick={stopTracking}>
                Stop counting stock
              </button>
            </>
          )}
        </Box>

        {/* ---- Launch & badges ---- */}
        <Box title="GOES LIVE & BADGES" tip="Leave the time empty to show the product as soon as it's saved. Set a time to keep it hidden from the shop until then — e.g. a drop at 10 pm — and it appears by itself.">
          <div className="pf-field pf-launch">
            <FieldLabel>GOES LIVE AT (OPTIONAL)</FieldLabel>
            <input
              type="datetime-local"
              value={p.publishAt || ''}
              onChange={(e) => set('publishAt', e.target.value)}
            />
            {p.publishAt && (
              <button type="button" className="pf-ghost mono pf-launch-clear" onClick={() => set('publishAt', '')}>
                Clear — live now
              </button>
            )}
            {p.publishAt && new Date(p.publishAt) > new Date() && (
              <em className="pf-hint mono">
                Hidden from the shop until {launchLabel(new Date(p.publishAt).toISOString())}.
              </em>
            )}
          </div>

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
        </Box>

        {/* ---- Size chart ---- */}
        <Box
          title="SIZE CHART"
          wide
          tip={<>Each product carries its own chart — a jacket and a tee don't measure the same way. Picking a category fills in the chart from the last product in that category ({p.category || 'none picked'}); change it if this one differs. Without a chart, the SIZE CHART button stays hidden on the page.</>}
        >
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
                <FieldLabel tip="Comma separated — usually the sizes you sell.">COLUMNS</FieldLabel>
                <input
                  className="mono"
                  value={p.sizeChart.columns.join(', ')}
                  onChange={(e) => setChartColumns(e.target.value)}
                  placeholder="S, M, L, XL"
                />
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
                <FieldLabel tip="One line per note, shown under the chart.">CHART NOTES</FieldLabel>
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
              </label>
            </div>
          )}
        </Box>
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
