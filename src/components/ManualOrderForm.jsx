import { useEffect, useMemo, useState } from 'react'
import { createManualOrder, extractOrderFromMessage, orderErrorMessage } from '../lib/admin.js'
import { sendOrderConfirmation } from '../lib/email.js'
import { DISTRICTS, quote, isTrxId, cleanTrxId } from '../lib/delivery.js'
import { availableSizes } from '../lib/stock.js'
import { fetchLiveSales, saleFor, salePrice } from '../lib/sales.js'
import { imgUrl } from '../lib/images.js'
import InfoTip from './InfoTip.jsx'
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

// A raw products row's price today, less any running sale.
function priceNow(row, sales) {
  const sale = saleFor({ id: row.id, drop: row.drop_name }, sales)
  return sale ? salePrice(row.price, sale.percent) : Number(row.price)
}

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
            <option key={p.id} value={p.id}>{p.id} · {p.name}{p.variant ? ` — ${p.variant}` : ''}</option>
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

  // place_order charges a running sale's price on manual orders too, so the
  // lines here have to carry it.
  const [sales, setSales] = useState([])
  useEffect(() => {
    fetchLiveSales().then(setSales)
  }, [])

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
          price: priceNow(product, sales),
          qty: Number(qty),
        },
      ]
    })
  }

  function removeItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  function changeQty(i, by) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, qty: Math.max(1, it.qty + by) } : it)))
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
          (p) => `${p.name}${p.variant ? ` — ${p.variant}` : ''}`.toLowerCase() === String(guess.product_match || '').toLowerCase()
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

    const finalTrxId = needsAdvance && trxId.trim() ? cleanTrxId(trxId) : null

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
        advance_trx_id: finalTrxId,
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

  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products])
  const pieces = items.reduce((n, it) => n + it.qty, 0)

  return (
    <form className="pform mof" onSubmit={handleSubmit}>
      <div className="pform-head">
        <h3 className="display">
          New order
          <InfoTip>For a sale agreed over DM or a call. It takes stock off the shelf and counts everywhere a website order does, tagged with where it came from instead of a tracked link. Its ID starts with PM.</InfoTip>
        </h3>
        <button type="button" className="pf-ghost mono" onClick={onCancel}>Cancel</button>
      </div>

      <div className="mof-layout">
        <div className="mof-main">
          {/* ---- 1 · Quick fill ---- */}
          <Box
            n="1"
            title="QUICK FILL"
            optional
            tip="Paste the customer's message, or upload a screenshot of the chat, then Extract. Gemini fills in the name, phone, address and district, and suggests the items — check each one before adding it. Nothing is saved until you press Place order."
          >
            <textarea
              className="mof-extract-text"
              rows={3}
              placeholder="Paste the chat message here…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="mof-extract-row">
              <label className={`mof-upload mono ${pickedImage ? 'on' : ''}`}>
                <input type="file" accept="image/*" onChange={handleImagePick} hidden />
                {pickedImage ? `✓ ${pickedImage.name}` : '+ Upload screenshot'}
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

            {suggestions.length > 0 && (
              <div className="mof-suggest">
                <div className="mof-sub mono">GEMINI'S GUESS — CHECK EACH ONE</div>
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
          </Box>

          {/* ---- 2 · Items ---- */}
          <Box
            n="2"
            title="ITEMS"
            tip="Pick a category to shorten the list, then the product (its ID is shown so two alike can't be mixed up), the size and how many. Only sizes in stock are listed. A running sale's price is used, as on the site."
          >
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
                {items.map((it, i) => {
                  const p = byId[String(it.product_id)]
                  return (
                    <div className="mof-item" key={`${it.product_id}-${it.size}`}>
                      <span className="mof-item-thumb">{p?.images?.[0] && <img src={imgUrl(p.images[0], { w: 80 })} alt="" />}</span>
                      <span className="mof-item-info">
                        <span className="mof-item-name">{it.product_name}</span>
                        <span className="mono mof-item-id">{it.product_id}{p?.variant ? ` · ${p.variant}` : ''} · {it.size} · {taka(it.price)}</span>
                      </span>
                      <span className="mof-qty mono">
                        <button type="button" onClick={() => changeQty(i, -1)} disabled={it.qty <= 1} aria-label="One less">−</button>
                        <b>{it.qty}</b>
                        <button type="button" onClick={() => changeQty(i, 1)} aria-label="One more">+</button>
                      </span>
                      <span className="mono mof-item-total">{taka(it.price * it.qty)}</span>
                      <button type="button" className="mof-item-x" onClick={() => removeItem(i)} aria-label="Remove item">×</button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mof-empty mono">No items added yet.</div>
            )}
          </Box>

          {/* ---- 3 · Customer ---- */}
          <Box
            n="3"
            title="CUSTOMER"
            tip="Who it goes to. The district sets the delivery charge and whether an advance is needed. With an email, the customer gets the same confirmation mail as a website order."
          >
            <div className="mof-grid">
              <label className="pf-field">
                <span className="mono">NAME</span>
                <input name="name" value={form.name} onChange={handleChange} placeholder="Customer's name" />
              </label>
              <label className="pf-field">
                <span className="mono">PHONE</span>
                <input name="phone" value={form.phone} onChange={handleChange} placeholder="017XXXXXXXX" inputMode="tel" />
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
              <label className="pf-field">
                <span className="mono">EMAIL (OPTIONAL)</span>
                <input name="email" value={form.email} onChange={handleChange} placeholder="Only for the confirmation mail" inputMode="email" />
              </label>
              <div className="pf-field mof-wide">
                <span className="mono">ADDRESS</span>
                <textarea name="address" value={form.address} onChange={handleChange} rows={2} placeholder="House, road, area" />
              </div>
            </div>
          </Box>

          {/* ---- 4 · Details ---- */}
          <Box n="4" title="WHERE IT CAME FROM" tip="Where the sale was agreed. Orders shows it as the order's source, and Overview counts it as its own row instead of Direct.">
            <div className="mof-sources mono" role="radiogroup" aria-label="Heard from">
              {DM_SOURCES.map((s) => (
                <button key={s.value} type="button" role="radio" aria-checked={source === s.value} className={source === s.value ? 'on' : ''} onClick={() => setSource(s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
            <label className="pf-field">
              <span className="mono">NOTE (OPTIONAL)</span>
              <input name="note" value={form.note} onChange={handleChange} placeholder="e.g. deliver after 5 pm" />
            </label>
          </Box>
        </div>

        {/* ---- Summary, kept in view on a PC ---- */}
        <aside className="mof-side">
          <Box title="SUMMARY" tip="The bill, worked out as on the website: items, then delivery for the district. Outside the advance-free zone an advance is due by bKash — enter its transaction ID if it's already been paid.">
            <div className="mof-sum">
              <div className="mof-sum-row"><span>Items</span><span className="mono">{pieces} piece{pieces === 1 ? '' : 's'}</span></div>
              <div className="mof-sum-row"><span>Subtotal</span><span className="mono">{taka(subtotal)}</span></div>
              <div className="mof-sum-row">
                <span>Delivery{bill.zone ? <em className="mono"> · {bill.zone.label}</em> : ''}</span>
                <span className="mono">{form.district ? taka(bill.fee) : 'pick a district'}</span>
              </div>
              <div className="mof-sum-row total"><span>Total</span><span className="mono">{taka(bill.total)}</span></div>
              {needsAdvance && (
                <div className="mof-sum-row adv"><span>Advance (bKash)</span><span className="mono">{taka(bill.advance)}</span></div>
              )}
            </div>

            {needsAdvance && (
              <label className="pf-field mof-trx">
                <span className="mono">BKASH TRX ID (IF PAID)</span>
                <input value={trxId} onChange={(e) => setTrxId(e.target.value)} placeholder="Leave blank if not yet" />
              </label>
            )}

            {error && <div className="pf-error mono mof-error">{error}</div>}

            <button type="submit" className="mof-submit mono" disabled={submitting}>
              {submitting ? 'Placing order…' : `Place order${items.length ? ` · ${taka(bill.total)}` : ''}`}
            </button>
            <div className="mof-checks mono">
              <span className={items.length ? 'ok' : ''}>{items.length ? '✓' : '○'} Items</span>
              <span className={form.name.trim() && form.phone.trim() ? 'ok' : ''}>{form.name.trim() && form.phone.trim() ? '✓' : '○'} Name &amp; phone</span>
              <span className={form.district && form.address.trim() ? 'ok' : ''}>{form.district && form.address.trim() ? '✓' : '○'} Address</span>
            </div>
          </Box>
        </aside>
      </div>
    </form>
  )
}

function Box({ n, title, tip, optional = false, children }) {
  return (
    <section className="mof-box">
      <div className="mof-box-head">
        {n && <span className="mof-step mono">{n}</span>}
        <span className="mof-box-title mono">{title}</span>
        {optional && <span className="mof-opt mono">optional</span>}
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      {children}
    </section>
  )
}
