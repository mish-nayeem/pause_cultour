import { useMemo, useState } from 'react'
import { createManualOrder, extractOrderFromMessage, orderErrorMessage } from '../lib/admin.js'
import { sendOrderConfirmation } from '../lib/email.js'
import { DISTRICTS, quote, isTrxId } from '../lib/delivery.js'
import { availableSizes } from '../lib/stock.js'
import './manual-order-form.css'

function taka(n) {
  return '৳ ' + Number(n).toLocaleString()
}

// Where the sale was actually agreed — separate from the Tracked Links
// sources, since nobody clicked a link for these. Tagged the same way
// (utm_source/utm_medium) so a DM sale still shows up as its own row on the
// Overview tab instead of disappearing into "Direct".
const DM_SOURCES = [
  { value: 'insta_dm', label: 'Instagram DM' },
  { value: 'messenger_dm', label: 'Messenger DM' },
  { value: 'whatsapp_dm', label: 'WhatsApp' },
  { value: 'phone_call', label: 'Phone call' },
  { value: 'in_person', label: 'In person / other' },
]

const NO_CATEGORY = '__none'
const EMPTY_DRAFT = { category: '', productId: '', size: '', qty: 1 }

function categoryOf(product) {
  return product?.category || NO_CATEGORY
}

// Category → product → size → qty, used both for adding an item by hand and for
// correcting one of Gemini's guesses. The category step narrows a long catalog
// down, and every product is listed with its ID so two similarly named ones
// can't be mixed up.
function ItemPicker({ products, value, onChange, onAdd, addLabel = 'Add', onDismiss }) {
  const [problem, setProblem] = useState('')

  const categories = useMemo(() => {
    const named = [...new Set(products.map((p) => p.category).filter(Boolean))].sort()
    return products.some((p) => !p.category) ? [...named, NO_CATEGORY] : named
  }, [products])

  const shown = value.category ? products.filter((p) => categoryOf(p) === value.category) : products
  const product = products.find((p) => String(p.id) === value.productId) || null
  const sizes = product ? availableSizes(product) : []

  function set(patch) {
    setProblem('')
    onChange({ ...value, ...patch })
  }

  function handleAdd() {
    if (!product) return setProblem('Pick a product first.')
    if (!value.size) return setProblem('Pick a size.')
    onAdd()
  }

  return (
    <div className="mof-picker">
      <div className="mof-pick-row">
        <select
          value={value.category}
          onChange={(e) => set({ category: e.target.value, productId: '', size: '' })}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c === NO_CATEGORY ? 'Uncategorised' : c}</option>
          ))}
        </select>
        <select
          value={value.productId}
          onChange={(e) => {
            const picked = products.find((p) => String(p.id) === e.target.value)
            // Choosing a product also files it under its category, so the
            // category box never disagrees with what's selected next to it.
            set({
              productId: e.target.value,
              size: '',
              category: picked ? categoryOf(picked) : value.category,
            })
          }}
        >
          <option value="">Select product</option>
          {shown.map((p) => (
            <option key={p.id} value={p.id}>{p.id} · {p.name} — {p.variant}</option>
          ))}
        </select>
      </div>
      <div className="mof-pick-row small">
        <select value={value.size} onChange={(e) => set({ size: e.target.value })} disabled={!product}>
          <option value="">Size</option>
          {sizes.map((sz) => (
            <option key={sz} value={sz}>{sz}</option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          value={value.qty}
          onChange={(e) => set({ qty: Math.max(1, Number(e.target.value)) })}
        />
        <button type="button" className="mof-add-btn mono" onClick={handleAdd}>{addLabel}</button>
        {onDismiss && (
          <button type="button" className="mof-item-x" onClick={onDismiss} title="Dismiss this suggestion">×</button>
        )}
      </div>
      {problem && <em className="pf-hint mono mof-problem">{problem}</em>}
      {product && sizes.length === 0 && (
        <em className="pf-hint mono">Every size of this product is sold out.</em>
      )}
    </div>
  )
}

export default function ManualOrderForm({ products, onCancel, onDone }) {
  const [form, setForm] = useState({
    name: '', phone: '', email: '', address: '', district: '', note: '',
  })
  const [source, setSource] = useState(DM_SOURCES[0].value)
  const [trxId, setTrxId] = useState('')
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  // Gemini's guesses, left for a person to confirm — never added on their own.
  const [suggestions, setSuggestions] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [pasteText, setPasteText] = useState('')
  const [pickedImage, setPickedImage] = useState(null) // { base64, mimeType, name }
  const [extracting, setExtracting] = useState(false)
  const [extractNote, setExtractNote] = useState('')

  const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0)
  const bill = useMemo(() => quote(subtotal, form.district), [subtotal, form.district])
  const needsAdvance = bill.advance > 0

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  function addItem({ productId, size, qty }) {
    const product = products.find((p) => String(p.id) === productId)
    if (!product || !size || qty < 1) return

    setItems((prev) => {
      const existing = prev.find((it) => it.product_id === product.id && it.size === size)
      if (existing) {
        return prev.map((it) =>
          it === existing ? { ...it, qty: it.qty + Number(qty) } : it
        )
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          size,
          price: Number(product.price),
          qty: Number(qty),
        },
      ]
    })
  }

  function removeItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  function handleImagePick(e) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      // readAsDataURL prefixes "data:image/jpeg;base64," — Gemini wants the
      // base64 payload on its own.
      const base64 = String(reader.result).split(',')[1]
      setPickedImage({ base64, mimeType: file.type, name: file.name })
    }
    reader.readAsDataURL(file)
  }

  // Fills the same fields a person would type into — nothing here is final
  // until "Place order" is pressed, so a wrong guess is just something to
  // notice and fix, not a mistake that reaches the database.
  async function handleExtract() {
    setExtracting(true)
    setExtractNote('')

    const { extracted, error: extractError } = await extractOrderFromMessage({
      text: pasteText.trim() || undefined,
      image: pickedImage?.base64,
      mimeType: pickedImage?.mimeType,
    })

    setExtracting(false)

    if (extractError || !extracted) {
      setExtractNote(extractError?.message || "Couldn't read that — fill the form in below.")
      return
    }

    setForm((prev) => ({
      ...prev,
      name: extracted.customer_name || prev.name,
      phone: extracted.customer_phone || prev.phone,
      email: extracted.customer_email || prev.email,
      address: extracted.customer_address || prev.address,
      district: DISTRICTS.includes(extracted.district) ? extracted.district : prev.district,
    }))

    const guesses = extracted.items || []

    setSuggestions(
      guesses.map((guess, i) => {
        const product = products.find(
          (p) => `${p.name} — ${p.variant}`.toLowerCase() === String(guess.product_match || '').toLowerCase()
        )
        const size = String(guess.size || '').toUpperCase()

        return {
          key: `${Date.now()}-${i}`,
          category: product ? categoryOf(product) : '',
          productId: product ? String(product.id) : '',
          size: product && availableSizes(product).includes(size) ? size : '',
          qty: Number(guess.qty) || 1,
        }
      })
    )

    setExtractNote(
      guesses.length > 0
        ? "Filled in the details. Gemini's item guesses are below — fix any that are wrong, then add them."
        : 'Filled in the details. It found no items, so add them below.'
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (items.length === 0) {
      setError('Add at least one item.')
      return
    }
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim() || !form.district) {
      setError('Name, phone, address and district are required.')
      return
    }
    if (needsAdvance && trxId.trim() && !isTrxId(trxId)) {
      setError('That does not look like a bKash transaction ID.')
      return
    }

    setSubmitting(true)

    const cleanTrxId = needsAdvance && trxId.trim() ? trxId.trim().toUpperCase() : null

    const { id: orderId, error: submitError } = await createManualOrder({
      order: {
        id_prefix: 'PM',
        customer_name: form.name,
        customer_phone: form.phone,
        customer_email: form.email.trim() || null,
        customer_address: form.address,
        customer_area: form.district,
        customer_note: form.note || null,
        subtotal,
        delivery_zone: bill.zone?.key || null,
        delivery_fee: bill.fee,
        total: bill.total,
        advance_amount: bill.advance,
        advance_method: needsAdvance ? 'bkash' : null,
        advance_trx_id: cleanTrxId,
        utm_source: source,
        utm_medium: 'dm',
      },
      items,
    })

    if (submitError) {
      setSubmitting(false)
      setError(orderErrorMessage(submitError))
      return
    }

    if (form.email.trim()) await sendOrderConfirmation(orderId)

    setSubmitting(false)
    onDone()
  }

  return (
    <form className="pform" onSubmit={handleSubmit}>
      <div className="pform-head">
        <h3 className="display">New order</h3>
        <button type="button" className="pf-ghost mono" onClick={onCancel}>Cancel</button>
      </div>

      <div className="pf-note">
        For a sale agreed over DM or a call — it takes stock off the shelf and
        counts everywhere a website order does, tagged with where it came
        from instead of a tracked link.
      </div>

      <div className="mof-extract">
        <div className="pf-label mono" style={{ marginTop: 0 }}>FILL FROM SCREENSHOT OR MESSAGE</div>
        <textarea
          className="mof-extract-text"
          rows={3}
          placeholder="Paste the chat message here…"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <div className="mof-extract-row">
          <label className="mof-upload mono">
            <input type="file" accept="image/*" onChange={handleImagePick} hidden />
            {pickedImage ? pickedImage.name : 'Upload screenshot'}
          </label>
          <button
            type="button"
            className="mof-extract-btn mono"
            onClick={handleExtract}
            disabled={extracting || (!pasteText.trim() && !pickedImage)}
          >
            {extracting ? 'Reading…' : 'Extract details'}
          </button>
        </div>
        {extractNote && <em className="pf-hint mono">{extractNote}</em>}
      </div>

      {error && <div className="pf-error mono">{error}</div>}

      {suggestions.length > 0 && (
        <div className="mof-suggest">
          <div className="pf-label mono" style={{ marginTop: 0 }}>GEMINI'S GUESS — CHECK EACH ONE</div>
          {suggestions.map((sg) => (
            <ItemPicker
              key={sg.key}
              products={products}
              value={sg}
              addLabel="Add to order"
              onChange={(next) =>
                setSuggestions((prev) => prev.map((x) => (x.key === sg.key ? { ...x, ...next } : x)))
              }
              onAdd={() => {
                addItem(sg)
                setSuggestions((prev) => prev.filter((x) => x.key !== sg.key))
              }}
              onDismiss={() => setSuggestions((prev) => prev.filter((x) => x.key !== sg.key))}
            />
          ))}
        </div>
      )}

      <div className="pf-label mono">ITEMS</div>
      <ItemPicker
        products={products}
        value={draft}
        onChange={setDraft}
        onAdd={() => {
          addItem(draft)
          setDraft(EMPTY_DRAFT)
        }}
      />

      {items.length > 0 ? (
        <div className="mof-items">
          {items.map((it, i) => (
            <div className="mof-item" key={`${it.product_id}-${it.size}`}>
              <span>
                <span className="mono mof-item-id">{it.product_id}</span> {it.product_name} · {it.size} × {it.qty}
              </span>
              <span className="mono">{taka(it.price * it.qty)}</span>
              <button type="button" className="mof-item-x" onClick={() => removeItem(i)}>×</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mof-empty mono">No items added yet.</div>
      )}

      <div className="pf-grid">
        <label className="pf-field">
          <span className="mono">NAME</span>
          <input name="name" value={form.name} onChange={handleChange} placeholder="Customer's name" />
        </label>
        <label className="pf-field">
          <span className="mono">PHONE</span>
          <input name="phone" value={form.phone} onChange={handleChange} placeholder="017XXXXXXXX" />
        </label>
        <label className="pf-field">
          <span className="mono">EMAIL (OPTIONAL)</span>
          <input name="email" value={form.email} onChange={handleChange} placeholder="Only for the confirmation mail" />
        </label>
        <label className="pf-field">
          <span className="mono">DISTRICT</span>
          <select name="district" value={form.district} onChange={handleChange}>
            <option value="">Select district</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <div className="pf-field" style={{ gridColumn: '1 / -1' }}>
          <span className="mono">ADDRESS</span>
          <textarea name="address" value={form.address} onChange={handleChange} rows={2} placeholder="House, road, area" />
        </div>
        <label className="pf-field">
          <span className="mono">HEARD FROM</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {DM_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="pf-field">
          <span className="mono">NOTE (OPTIONAL)</span>
          <input name="note" value={form.note} onChange={handleChange} />
        </label>
      </div>

      {form.district && (
        <div className="mof-bill mono">
          <span>Subtotal {taka(subtotal)} + delivery {taka(bill.fee)} ({bill.zone?.label})</span>
          <span className="mof-bill-total">Total {taka(bill.total)}</span>
        </div>
      )}

      {needsAdvance && (
        <label className="pf-field">
          <span className="mono">BKASH TRANSACTION ID (IF ALREADY COLLECTED)</span>
          <input value={trxId} onChange={(e) => setTrxId(e.target.value)} placeholder="Leave blank if not collected yet" />
        </label>
      )}

      <button type="submit" className="mof-submit mono" disabled={submitting}>
        {submitting ? 'Placing order…' : 'Place order'}
      </button>
    </form>
  )
}
