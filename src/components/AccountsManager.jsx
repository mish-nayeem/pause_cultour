import { useEffect, useMemo, useState } from 'react'
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'
import { fetchCustomerAccounts } from '../lib/account.js'
import { fetchSetting, saveSetting } from '../lib/siteSettings.js'
import './accounts-manager.css'

function taka(n) {
  return '৳ ' + Math.round(Number(n || 0)).toLocaleString()
}

function day(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ordered', label: 'Have ordered' },
  { key: 'never', label: 'Never ordered' },
  { key: 'subscribed', label: 'On mailing list' },
]

// One CSV cell: quoted, inner quotes doubled.
function cell(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

// Admin → Customers → Accounts. Every customer who signed in, with what
// they saved at checkout and everything they've ordered (matched by the
// account's email), for email marketing: filter, then copy the emails or
// download them as a CSV for Brevo / Mailchimp.
export default function AccountsManager({ orders, onOpenOrder }) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [copied, setCopied] = useState(false)
  const [early, setEarly] = useState('')
  const [earlyNote, setEarlyNote] = useState('')

  useEffect(() => {
    fetchCustomerAccounts().then(({ accounts, error }) => {
      setAccounts(accounts)
      setError(error || '')
      setLoading(false)
    })
    fetchSetting('early_access_hours').then(({ value }) => setEarly(value == null ? '0' : String(value)))
  }, [])

  // Each account with its orders.
  const rows = useMemo(() => {
    const byEmail = new Map()
    for (const o of orders) {
      const e = (o.customer_email || '').trim().toLowerCase()
      if (!e) continue
      if (!byEmail.has(e)) byEmail.set(e, [])
      byEmail.get(e).push(o)
    }
    return accounts.map((a) => {
      const mine = (byEmail.get((a.email || '').toLowerCase()) || []).sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
      const last = mine[0]
      return {
        ...a,
        orders: mine,
        // Nothing saved on the account yet: what their latest order says.
        name: a.name || last?.customer_name || '',
        phone: a.phone || last?.customer_phone || '',
        district: a.district || last?.customer_area || '',
        spent: mine.filter((o) => o.status === 'delivered').reduce((n, o) => n + Number(o.total ?? o.subtotal ?? 0), 0),
        lastOrderAt: last?.created_at || null,
      }
    })
  }, [accounts, orders])

  const shown = useMemo(() => {
    const text = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'ordered' && r.orders.length === 0) return false
      if (filter === 'never' && r.orders.length > 0) return false
      if (filter === 'subscribed' && !r.subscribed) return false
      if (!text) return true
      return [r.email, r.name, r.phone, r.district].some((v) => String(v || '').toLowerCase().includes(text))
    })
  }, [rows, filter, q])

  const counts = {
    all: rows.length,
    ordered: rows.filter((r) => r.orders.length > 0).length,
    never: rows.filter((r) => r.orders.length === 0).length,
    subscribed: rows.filter((r) => r.subscribed).length,
  }

  async function copyEmails() {
    try {
      await navigator.clipboard.writeText(shown.map((r) => r.email).join(', '))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked — the CSV still works */ }
  }

  function downloadCsv() {
    const head = ['email', 'name', 'phone', 'district', 'area_thana', 'postcode', 'address', 'orders', 'delivered_spent', 'last_order', 'joined', 'last_sign_in', 'mailing_list']
    const lines = shown.map((r) => [
      r.email, r.name, r.phone, r.district, r.thana, r.postcode, r.address,
      r.orders.length, Math.round(r.spent), r.lastOrderAt?.slice(0, 10) || '', r.joined_at?.slice(0, 10) || '',
      r.last_sign_in_at?.slice(0, 10) || '', r.subscribed ? 'yes' : 'no',
    ].map(cell).join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pause-accounts-${filter}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function saveEarly(e) {
    e.preventDefault()
    const n = Math.max(0, Math.min(168, Number(early) || 0))
    const { error } = await saveSetting('early_access_hours', n)
    setEarly(String(n))
    setEarlyNote(error ? "Couldn't save — try again." : n ? `Saved — members see new drops ${n} hour${n === 1 ? '' : 's'} early.` : 'Saved — early access is off.')
  }

  return (
    <div className="acm">
      <div className="ab-grid">
        <AdminBox
          wide
          title="CUSTOMER ACCOUNTS"
          side={loading ? '' : `${rows.length} account${rows.length === 1 ? '' : 's'}`}
          tip={
            <>
              <p>Everyone who signed in on the site (with the login code or Google), with the details they saved at checkout or on their Account page, and every order placed with their email.</p>
              <p><b>Email marketing:</b> pick a filter, then <b>Copy emails</b> (paste into Brevo, Gmail BCC…) or <b>Download CSV</b> (import into Brevo / Mailchimp as a contact list).</p>
              <p><b>On mailing list</b> = they ticked "Email me with news and offers". Send promotions to them first.</p>
              <p>Tap a row to see their details and orders.</p>
            </>
          }
        >
          {error && <div className="ab-warn mono">{error}</div>}

          <div className="acm-tools">
            <div className="chips mono">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" className={`chip ${filter === f.key ? 'on' : ''}`} onClick={() => setFilter(f.key)}>
                  {f.label.toUpperCase()} <span className="chip-count">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <input className="ab-input acm-search" placeholder="Search email, name, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="acm-actions">
              <button type="button" className="ab-btn" disabled={!shown.length} onClick={copyEmails}>
                {copied ? 'Copied ✓' : `Copy ${shown.length} email${shown.length === 1 ? '' : 's'}`}
              </button>
              <button type="button" className="ab-btn" disabled={!shown.length} onClick={downloadCsv}>Download CSV</button>
            </div>
          </div>

          {loading ? (
            <div className="ab-empty mono">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="ab-empty mono">{rows.length ? 'No account matches.' : 'No customer has signed in yet.'}</div>
          ) : (
            <div className="acm-list">
              {shown.map((r) => (
                <div key={r.user_id} className={`acm-row ${open === r.user_id ? 'open' : ''}`}>
                  <button type="button" className="acm-main" onClick={() => setOpen(open === r.user_id ? null : r.user_id)}>
                    <span className="acm-who">
                      <b>{r.name || r.email}</b>
                      <span className="mono">{r.email}{r.phone ? ` · ${r.phone}` : ''}</span>
                    </span>
                    <span className="acm-nums mono">
                      <b>{r.orders.length} order{r.orders.length === 1 ? '' : 's'}</b>
                      <span>{r.spent ? `${taka(r.spent)} delivered` : 'nothing delivered'}</span>
                    </span>
                    {r.subscribed && <span className="acm-tag mono" title="On the mailing list">✉</span>}
                  </button>

                  {open === r.user_id && (
                    <div className="acm-more">
                      <div className="acm-facts mono">
                        <span>Joined {day(r.joined_at)}</span>
                        <span>Last sign-in {day(r.last_sign_in_at)}</span>
                        <span>Last order {day(r.lastOrderAt)}</span>
                        <span>{r.subscribed ? 'On mailing list' : 'Not on mailing list'}</span>
                      </div>
                      <div className="acm-addr">
                        <span className="mono">SAVED DETAILS</span>
                        {r.address || r.thana || r.district ? (
                          <p>
                            {r.name}{r.phone ? ` · ${r.phone}` : ''}<br />
                            {[r.address, [r.thana, r.postcode].filter(Boolean).join(' - '), r.district].filter(Boolean).join(', ')}
                          </p>
                        ) : (
                          <p className="dim">Nothing saved yet — fills in at their next checkout.</p>
                        )}
                      </div>
                      {r.orders.length > 0 && (
                        <div className="acm-orders">
                          <span className="mono">ORDERS</span>
                          {r.orders.map((o) => (
                            <button key={o.id} type="button" className="acm-order mono" onClick={() => onOpenOrder(o.id)}>
                              <span>{o.id}</span>
                              <span>{day(o.created_at)}</span>
                              <span className={`today-status ${o.status}`}>{o.status}</span>
                              <span>{taka(o.total ?? o.subtotal)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </AdminBox>

        <AdminBox
          title="MEMBER EARLY ACCESS"
          tip={
            <>
              <p>Signed-in customers see a scheduled drop — and can buy it — this many hours before everyone else.</p>
              <p>Example: a drop set for 10 pm with 2 hours → members from 8 pm, everyone at 10 pm. 0 turns it off.</p>
              <p>Set the drop's time on the product (Launch time).</p>
            </>
          }
        >
          <form className="acm-early" onSubmit={saveEarly}>
            <input
              className="ab-input"
              type="number"
              min="0"
              max="168"
              step="1"
              value={early}
              onChange={(e) => { setEarly(e.target.value); setEarlyNote('') }}
            />
            <span className="mono">hours early</span>
            <button type="submit" className="ab-btn">Save</button>
          </form>
          {earlyNote && <div className="ab-note mono">{earlyNote}</div>}
        </AdminBox>
      </div>

      <div className="acm-foot mono">
        Accounts and saved details need supabase-migration-customer-accounts.sql.
        <InfoTip>Run it once in Supabase → SQL Editor. It adds the saved-details table, My orders on the customer's Account page, this list, and member early access.</InfoTip>
      </div>
    </div>
  )
}
