import { useEffect, useMemo, useState } from 'react'
import { fetchCoupons, createCoupon, setCouponActive, deleteCoupon, describeCoupon } from '../lib/coupons.js'
import './coupon-manager.css'

const BLANK = {
  code: '',
  kind: 'percent',
  value: '',
  min_subtotal: '',
  max_discount: '',
  usage_limit: '',
  per_customer_limit: '1',
  starts_at: '',
  ends_at: '',
}

function taka(n) {
  return '৳ ' + Number(n || 0).toLocaleString()
}

// A date picked in the form is a whole day in Dhaka: a start opens at
// midnight, an end closes at 23:59:59.
function dhaka(date, endOfDay) {
  if (!date) return null
  return `${date}T${endOfDay ? '23:59:59' : '00:00:00'}+06:00`
}

function day(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

function numOrNull(v) {
  return v === '' || v == null ? null : Number(v)
}

// Admin → Marketing → Coupons. Coupons are made here and switched on or off;
// how often each was used, what it gave away and what it sold are worked out
// from the orders themselves (cancelled ones don't count).
export default function CouponManager({ orders }) {
  const [coupons, setCoupons] = useState([])
  const [draft, setDraft] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { coupons } = await fetchCoupons()
    setCoupons(coupons)
  }

  useEffect(() => { load() }, [])

  const usage = useMemo(() => {
    const map = {}
    for (const o of orders) {
      if (!o.coupon_code || o.status === 'cancelled') continue
      const u = (map[o.coupon_code] ||= { uses: 0, given: 0, sales: 0 })
      u.uses += 1
      u.given += Number(o.discount_amount) || 0
      u.sales += Number(o.total ?? o.subtotal) || 0
    }
    return map
  }, [orders])

  function set(k, v) {
    setDraft((d) => ({ ...d, [k]: v }))
    setError('')
  }

  async function handleCreate(e) {
    e.preventDefault()
    const code = draft.code.trim().toUpperCase()
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return setError('Code: 3–24 letters, numbers, - or _ (e.g. EID10).')
    const value = Number(draft.value)
    if (!(value > 0)) return setError('Enter how much it takes off.')
    if (draft.kind === 'percent' && value > 100) return setError('A percent coupon can be at most 100%.')
    if (draft.starts_at && draft.ends_at && draft.ends_at < draft.starts_at) return setError('The end date is before the start date.')

    setSaving(true)
    const { error: saveError } = await createCoupon({
      code,
      kind: draft.kind,
      value,
      min_subtotal: Number(draft.min_subtotal) || 0,
      max_discount: draft.kind === 'percent' ? numOrNull(draft.max_discount) : null,
      usage_limit: numOrNull(draft.usage_limit),
      per_customer_limit: numOrNull(draft.per_customer_limit),
      starts_at: dhaka(draft.starts_at, false),
      ends_at: dhaka(draft.ends_at, true),
    })
    setSaving(false)

    if (saveError) {
      setError(saveError.code === '23505' ? `${code} already exists.` : "Couldn't save — check the fields and try again.")
      return
    }
    setDraft(BLANK)
    load()
  }

  async function toggle(c) {
    await setCouponActive(c.code, !c.active)
    load()
  }

  async function remove(c) {
    await deleteCoupon(c.code)
    load()
  }

  function status(c) {
    const now = new Date()
    if (!c.active) return { label: 'OFF', tone: 'off' }
    if (c.ends_at && new Date(c.ends_at) < now) return { label: 'EXPIRED', tone: 'off' }
    if (c.starts_at && new Date(c.starts_at) > now) return { label: 'SCHEDULED', tone: 'soon' }
    if (c.usage_limit != null && (usage[c.code]?.uses || 0) >= c.usage_limit) return { label: 'USED UP', tone: 'off' }
    return { label: 'LIVE', tone: 'live' }
  }

  return (
    <>
      <form className="pform cp-form" onSubmit={handleCreate}>
        <div className="pform-head"><h3 className="display">New coupon</h3></div>
        <div className="pf-grid">
          <label className="pf-field">
            <span className="mono">CODE</span>
            <input value={draft.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="EID10" />
            <em className="pf-hint mono">What the customer types at checkout.</em>
          </label>

          <label className="pf-field">
            <span className="mono">DISCOUNT</span>
            <div className="cp-amount">
              <select value={draft.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="percent">% off</option>
                <option value="fixed">৳ off</option>
              </select>
              <input type="number" min="1" value={draft.value} onChange={(e) => set('value', e.target.value)} placeholder={draft.kind === 'percent' ? '10' : '200'} />
            </div>
            <em className="pf-hint mono">Off the items only — delivery is charged as usual.</em>
          </label>

          <label className="pf-field">
            <span className="mono">MINIMUM ORDER (৳, OPTIONAL)</span>
            <input type="number" min="0" value={draft.min_subtotal} onChange={(e) => set('min_subtotal', e.target.value)} placeholder="0" />
          </label>

          {draft.kind === 'percent' && (
            <label className="pf-field">
              <span className="mono">MAX DISCOUNT (৳, OPTIONAL)</span>
              <input type="number" min="1" value={draft.max_discount} onChange={(e) => set('max_discount', e.target.value)} placeholder="No cap" />
            </label>
          )}

          <label className="pf-field">
            <span className="mono">TOTAL USES (OPTIONAL)</span>
            <input type="number" min="1" value={draft.usage_limit} onChange={(e) => set('usage_limit', e.target.value)} placeholder="Unlimited" />
            <em className="pf-hint mono">e.g. 50 — the first 50 orders get it.</em>
          </label>

          <label className="pf-field">
            <span className="mono">USES PER CUSTOMER</span>
            <input type="number" min="1" value={draft.per_customer_limit} onChange={(e) => set('per_customer_limit', e.target.value)} placeholder="Unlimited" />
            <em className="pf-hint mono">Counted by phone number. Leave empty for no limit.</em>
          </label>

          <label className="pf-field">
            <span className="mono">STARTS (OPTIONAL)</span>
            <input type="date" value={draft.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
          </label>

          <label className="pf-field">
            <span className="mono">ENDS (OPTIONAL)</span>
            <input type="date" value={draft.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
            <em className="pf-hint mono">Works until 11:59 pm that day.</em>
          </label>
        </div>

        {error && <div className="cp-error mono">{error}</div>}

        <button type="submit" className="mof-submit mono" disabled={saving}>
          {saving ? 'Saving…' : 'Create coupon'}
        </button>
      </form>

      <section className="panel">
        <div className="panel-label mono" style={{ marginBottom: '14px' }}>COUPONS</div>
        {coupons.length === 0 && <div className="empty mono">No coupons yet — make one above.</div>}

        {coupons.length > 0 && (
          <div className="cp-table">
            <div className="cp-row cp-th mono">
              <span>CODE</span>
              <span>DISCOUNT</span>
              <span>DATES</span>
              <span>USED</span>
              <span>GIVEN</span>
              <span>SALES</span>
              <span>STATUS</span>
              <span />
            </div>
            {coupons.map((c) => {
              const u = usage[c.code] || { uses: 0, given: 0, sales: 0 }
              const st = status(c)
              return (
                <div className="cp-row" key={c.code}>
                  <span className="mono cp-code">{c.code}</span>
                  <span>{describeCoupon(c)}</span>
                  <span className="mono dim">
                    {c.starts_at || c.ends_at ? `${day(c.starts_at) || '…'} → ${day(c.ends_at) || '…'}` : 'Any time'}
                  </span>
                  <span className="mono">
                    {u.uses}{c.usage_limit != null ? ` / ${c.usage_limit}` : ''}
                  </span>
                  <span className="mono">{taka(u.given)}</span>
                  <span className="mono">{taka(u.sales)}</span>
                  <span className={`cp-status mono ${st.tone}`}>{st.label}</span>
                  <span className="cp-actions">
                    <button type="button" onClick={() => toggle(c)}>{c.active ? 'Turn off' : 'Turn on'}</button>
                    {/* A used coupon stays on its orders — it can be switched
                        off, not deleted. */}
                    {u.uses === 0 && (
                      <button type="button" className="cp-del" onClick={() => remove(c)} aria-label={`Delete ${c.code}`}>×</button>
                    )}
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
