import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl, uploadImage } from '../lib/images.js'
import { saveProduct } from '../lib/admin.js'
import { stockMap } from '../lib/stock.js'
import InfoTip from './InfoTip.jsx'
import { IconX } from './Icons.jsx'
// The form's own id and colour-tag rules (a circular import is fine here:
// both are only called once the page is running).
import { nextProductId as nextId, tagOf } from './ProductForm.jsx'

// Add another colour, right after a product is added (or from its edit
// form). The piece is the lead: the shop shows its card only, and its
// product page shows every colour as a small photo. Each colour here needs
// just its photos and how many there are — everything else (name, price,
// sizes, chart, details) is the lead's. A colour name is optional.
export default function QuickColours({ base, existingIds, onDone }) {
  const tracked = stockMap(base) !== null
  const blank = () => ({
    variant: '',
    images: [],
    stock: Object.fromEntries((base.sizes || []).map((s) => [s, 0])),
  })
  const [form, setForm] = useState(blank)
  const [added, setAdded] = useState([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const usedIds = useRef([...existingIds, base.id])
  const group = useRef(base.colourGroup || tagOf(base.name))

  async function pickPhotos(e) {
    const files = [...(e.target.files || [])]
    if (!files.length) return
    setUploading(true)
    setError('')
    try {
      const urls = []
      for (const file of files) urls.push(await uploadImage(file, supabase, 'products'))
      setForm((f) => ({ ...f, images: [...f.images, ...urls] }))
    } catch (err) {
      setError(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    if (form.images.length === 0) return setError('Add at least one photo of this colour.')
    setSaving(true)
    setError('')

    const id = nextId(usedIds.current)
    const { error: saveError } = await saveProduct(
      {
        ...base,
        id,
        sku: id.toUpperCase(),
        variant: form.variant.trim(),
        images: form.images,
        sizesOut: [],
        stock: tracked ? form.stock : null,
        featured: false,
        colourGroup: group.current,
      },
      true
    )

    if (saveError) {
      setSaving(false)
      setError(saveError.message?.includes('duplicate') ? 'That ID was just taken — press Upload again.' : "Couldn't save. Check your connection and try again.")
      if (saveError.message?.includes('duplicate')) usedIds.current.push(id)
      return
    }

    // The lead joins the same colour group, if it had none yet.
    if (!base.colourGroup && added.length === 0) {
      await supabase.from('products').update({ colour_group: group.current }).eq('id', base.id)
    }

    usedIds.current.push(id)
    setAdded((a) => [...a, { id, variant: form.variant.trim(), image: form.images[0], pieces: tracked ? Object.values(form.stock).reduce((n, v) => n + (Number(v) || 0), 0) : null }])
    setForm(blank())
    setSaving(false)
  }

  const total = Object.values(form.stock).reduce((n, v) => n + (Number(v) || 0), 0)

  return (
    <div className="pform qc">
      <div className="pform-head">
        <h3 className="display">
          {base.name}
          <InfoTip>
            <p>The shop shows one card for this piece — this colour, the lead — sliding through its own photos only.</p>
            <p>Open it and every colour shows as a small photo under the price; tapping one shows that colour's photos.</p>
            <p>Colours belong together by name: anything named {base.name} is a colour of this piece.</p>
          </InfoTip>
        </h3>
        <button type="button" className="courier-btn mono qc-done" onClick={onDone}>Done</button>
      </div>

      <div className="qc-colours">
        <div className="qc-colour lead">
          <span className="qc-thumb">{base.images?.[0] && <img src={imgUrl(base.images[0], { w: 160 })} alt="" />}</span>
          <span className="qc-cname mono">{base.variant || 'Lead colour'}</span>
          <span className="qc-tag mono">LEAD · ON THE SHOP</span>
        </div>
        {added.map((c) => (
          <div className="qc-colour" key={c.id}>
            <span className="qc-thumb"><img src={imgUrl(c.image, { w: 160 })} alt="" /></span>
            <span className="qc-cname mono">{c.variant || 'Colour'}</span>
            <span className="qc-tag mono">✓ {c.pieces != null ? `${c.pieces} pcs` : 'added'}</span>
          </div>
        ))}
      </div>

      <section className="pf-sec qc-box">
        <div className="pf-sec-head">
          <span className="pf-sec-title mono">+ ADD ANOTHER COLOUR</span>
          <InfoTip>Just this colour's photos and how many of each size there are. Name, price, sizes, size chart and details are copied from {base.name}. Press Upload colour, then add the next one, or Done.</InfoTip>
        </div>

        <div className="qc-grid">
          <div className="qc-col">
            <span className="pf-flabel mono">PHOTOS</span>
            <div className="qc-photos">
              {form.images.map((url, i) => (
                <div className="qc-photo" key={url}>
                  <img src={imgUrl(url, { w: 200 })} alt="" />
                  {i === 0 && <span className="qc-main mono">MAIN</span>}
                  <button type="button" onClick={() => setForm((f) => ({ ...f, images: f.images.filter((x) => x !== url) }))} aria-label="Remove photo">
                    <IconX width="11" height="11" />
                  </button>
                </div>
              ))}
              <label className={`qc-add mono ${uploading ? 'busy' : ''}`}>
                {uploading ? 'Uploading…' : '+ Photos'}
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={pickPhotos} disabled={uploading} hidden />
              </label>
            </div>
          </div>

          <div className="qc-col">
            {tracked && (
              <>
                <span className="pf-flabel mono">HOW MANY</span>
                <div className="qc-stock">
                  {(base.sizes || []).map((s) => (
                    <label key={s} className="qc-size mono">
                      <span>{s}</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={form.stock[s] ?? 0}
                        onChange={(e) => setForm((f) => ({ ...f, stock: { ...f.stock, [s]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) } }))}
                      />
                    </label>
                  ))}
                </div>
                <div className="qc-total mono">Total {total} pieces</div>
              </>
            )}

            <label className="pf-field qc-name">
              <span className="pf-flabel mono">COLOUR NAME (OPTIONAL)</span>
              <input value={form.variant} onChange={(e) => setForm((f) => ({ ...f, variant: e.target.value }))} placeholder="e.g. Green" maxLength={40} />
            </label>
          </div>
        </div>

        {error && <div className="pf-error mono qc-error">{error}</div>}

        <div className="qc-actions">
          <button type="button" className="courier-btn mono" onClick={save} disabled={saving || uploading}>
            {saving ? 'Uploading…' : 'Upload colour'}
          </button>
          <span className="qc-note mono">{added.length ? `${added.length} colour${added.length === 1 ? '' : 's'} added` : ''}</span>
        </div>
      </section>
    </div>
  )
}
