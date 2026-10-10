import { useEffect, useMemo, useState } from 'react'
import { listSales, createSale, setSaleActive, deleteSale, salePrice } from '../lib/sales.js'
import './coupon-manager.css'
import './sale-manager.css'

const BLANK = {
  name: '',
  percent: '',
  target: 'drop', // drop | products | all
  drop_name: '',
  product_ids: [],
  starts_at: '',
  ends_at: '',
}

function when(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

// Admin → Marketing → Sales. A percent off a drop, some products or the
// whole store, from a start time to an end time. The shop shows the struck
// price and a countdown while it runs; place_order charges the same price.
export default function SaleManager({ products }) {
  const [sales, setSales] = useState([])
  const [draft, setDraft] = useState(BLANK)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { sales } = await listSales()
    setSales(sales)
  }

  useEffect(() => { load() }, [])

  const drops = useMemo(
    () => [...new Set(products.map((p) => p.drop_name).filter(Boolean))].sort(),
    [products]
  )

  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products])

  const matches = products.filter((p) =>
    `${p.name} ${p.variant || ''} ${p.id}`.toLowerCase().includes(search.trim().toLowerCase())
  )

  function set(k, v) {
    setDraft((d) => ({ ...d, [k]: v }))
    setError('')
  }

  function toggleProduct(id) {
    setDraft((d) => ({
      ...d,
      product_ids: d.product_ids.includes(id) ? d.product_ids.filter((x) => x !== id) : [...d.product_ids, id],
    }))
    setError('')
  }

  // What the sale covers, in words.
  function describe(s) {
    if (s.drop_name) return `Drop: ${s.drop_name}`
    const ids = s.product_ids || []
    if (ids.length === 0) return 'Whole store'
    const names = ids.map((id) => byId[id]?.name || id)
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ')
  }

  async function handleCreate(e) {
    e.preventDefault()
    const percent = Number(draft.percent)
    if (!Number.isInteger(percent) || percent < 1 || percent > 90) return setError('Percent: a whole number from 1 to 90.')
    if (draft.target === 'drop' && !draft.drop_name) return setError('Pick the drop.')
    if (draft.target === 'products' && draft.product_ids.length === 0) return setError('Tick at least one product.')
    if (!draft.ends_at) return setError('Pick when the sale ends.')

    // datetime-local is the admin's own clock (Dhaka); toISOString turns it
    // into the right moment for the database.
    const starts = draft.starts_at ? new Date(draft.starts_at) : new Date()
    const ends = new Date(draft.ends_at)
    if (ends <= starts) return setError('The end time has to be after the start.')
    if (ends <= new Date()) return setError('The end time is already past.')

    setSaving(true)
    const { error: saveError } = await createSale({
      name: draft.name.trim(),
      percent,
      drop_name: draft.target === 'drop' ? draft.drop_name : null,
      product_ids: draft.target === 'products' ? draft.product_ids : null,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
    })
    setSaving(false)

    if (saveError) {
      setError("Couldn't save — has supabase-migration-sales.sql been run?")
      return
    }
    setDraft(BLANK)
    setSearch('')
    load()
  }

  async function toggle(s) {
    await setSaleActive(s.id, !s.active)
    load()
  }

  async function remove(s) {
    if (!window.confirm(`Delete the ${s.percent}% sale${s.name ? ` "${s.name}"` : ''}?`)) return
    await deleteSale(s.id)
    load()
  }

  function status(s) {
    const now = new Date()
    if (!s.active) return { label: 'OFF', tone: 'off' }
    if (new Date(s.ends_at) <= now) return { label: 'ENDED', tone: 'off' }
    if (new Date(s.starts_at) > now) return { label: 'SCHEDULED', tone: 'soon' }
    return { label: 'LIVE', tone: 'live' }
  }

  const example = byId[draft.product_ids[0]] || products.find((p) => p.drop_name === draft.drop_name) || products[0]
  const pct = Number(draft.percent)

  return (
    <>
      <form className="pform cp-form" onSubmit={handleCreate}>
        <div className="pform-head"><h3 className="display">New sale</h3></div>
        <div className="pf-grid">
          <label className="pf-field">
            <span className="mono">NAME (OPTIONAL)</span>
            <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Eid sale" />
            <em className="pf-hint mono">Shown on the product page next to the countdown.</em>
          </label>

          <label className="pf-field">
            <span className="mono">PERCENT OFF</span>
            <input type="number" min="1" max="90" value={draft.percent} onChange={(e) => set('percent', e.target.value)} placeholder="20" />
            <em className="pf-hint mono">
              {example && pct >= 1 && pct <= 90
                ? `e.g. ${example.name}: ৳${Number(example.price).toLocaleString()} → ৳${salePrice(example.price, pct).toLocaleString()}`
                : 'Rounded to the nearest taka.'}
            </em>
          </label>

          <label className="pf-field">
            <span className="mono">STARTS</span>
            <input type="datetime-local" value={draft.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
            <em className="pf-hint mono">Leave empty to start right away.</em>
          </label>

          <label className="pf-field">
            <span className="mono">ENDS</span>
            <input type="datetime-local" value={draft.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
            <em className="pf-hint mono">Prices go back to normal at this time by themselves.</em>
          </label>

          <div className="pf-field sm-wide">
            <span className="mono">ON</span>
            <div className="sm-targets">
              {[
                ['drop', 'A drop'],
                ['products', 'Chosen products'],
                ['all', 'Whole store'],
              ].map(([k, label]) => (
                <button
                  type="button"
                  key={k}
                  className={`sm-target mono ${draft.target === k ? 'active' : ''}`}
                  onClick={() => set('target', k)}
                >
                  {label}
                </button>
              ))}
            </div>

            {draft.target === 'drop' && (
              <select value={draft.drop_name} onChange={(e) => set('drop_name', e.target.value)}>
                <option value="">Pick a drop…</option>
                {drops.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}

            {draft.target === 'products' && (
              <>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" />
                <div className="sm-picks">
                  {matches.map((p) => {
                    const id = String(p.id)
                    return (
                      <label key={id} className={`sm-pick ${draft.product_ids.includes(id) ? 'on' : ''}`}>
                        <input type="checkbox" checked={draft.product_ids.includes(id)} onChange={() => toggleProduct(id)} />
                        <span>{p.name}{p.variant ? ` — ${p.variant}` : ''}</span>
                        <span className="mono dim">৳{Number(p.price).toLocaleString()}</span>
                      </label>
                    )
                  })}
                  {matches.length === 0 && <div className="empty mono">No products match.</div>}
                </div>
                <em className="pf-hint mono">{draft.product_ids.length} selected</em>
              </>
            )}

            {draft.target === 'all' && <em className="pf-hint mono">Every product in the shop.</em>}
          </div>
        </div>

        {error && <div className="cp-error mono">{error}</div>}

        <button type="submit" className="mof-submit mono" disabled={saving}>
          {saving ? 'Saving…' : 'Create sale'}
        </button>
      </form>

      <section className="panel">
        <div className="panel-label mono" style={{ marginBottom: '14px' }}>SALES</div>
        {sales.length === 0 && <div className="empty mono">No sales yet — make one above.</div>}

        {sales.length > 0 && (
          <div className="cp-table">
            <div className="cp-row sm-row cp-th mono">
              <span>OFF</span>
              <span>NAME</span>
              <span>ON</span>
              <span>WHEN</span>
              <span>STATUS</span>
              <span />
            </div>
            {sales.map((s) => {
              const st = status(s)
              return (
                <div className="cp-row sm-row" key={s.id}>
                  <span className="mono cp-code">{s.percent}%</span>
                  <span>{s.name || '—'}</span>
                  <span>{describe(s)}</span>
                  <span className="mono dim">{when(s.starts_at)} → {when(s.ends_at)}</span>
                  <span className={`cp-status mono ${st.tone}`}>{st.label}</span>
                  <span className="cp-actions">
                    {st.label !== 'ENDED' && (
                      <button type="button" onClick={() => toggle(s)}>{s.active ? 'Turn off' : 'Turn on'}</button>
                    )}
                    <button type="button" className="cp-del" onClick={() => remove(s)} aria-label="Delete sale">×</button>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
