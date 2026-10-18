import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { dropKey } from '../lib/lookbook.js'
import './audience-manager.css'

function taka(n) {
  return '৳ ' + Number(n || 0).toLocaleString()
}

function day(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

// Admin → Marketing → Customers & emails. Everyone the shop can reach: the
// mailing list (footer JOIN, checkout's "Email me with news and offers") and
// every customer who has ordered, with what they bought. Narrow it down —
// subscribers only, people who bought a product or drop — tick who you want,
// then copy their emails or phone numbers, or download a CSV for Brevo.
export default function AudienceManager({ orders, products }) {
  const [subs, setSubs] = useState([])
  const [subsError, setSubsError] = useState('')
  const [who, setWho] = useState('all') // all | subscribed | customers
  const [bought, setBought] = useState('') // '' | 'p:<id>' | 'd:<drop>'
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [note, setNote] = useState('')

  useEffect(() => {
    supabase
      .from('subscribers')
      .select('*')
      .then(({ data, error }) => {
        if (error) setSubsError("Couldn't load the mailing list — has supabase-migration-audience.sql been run?")
        setSubs(data || [])
      })
  }, [])

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products])

  // One row per person: customers by phone number, plus anyone on the
  // mailing list who hasn't ordered (matched to a customer by email).
  const people = useMemo(() => {
    const byPhone = new Map()
    for (const o of orders) {
      const key = (o.customer_phone || '').trim()
      if (!key) continue
      const row = byPhone.get(key) || {
        key, name: o.customer_name, phone: key, email: '', orders: 0, spent: 0, last: null,
        productIds: new Set(), drops: new Set(), subscribed: false, joined: null,
      }
      if (o.customer_email && !row.email) row.email = o.customer_email.trim().toLowerCase()
      if (!row.last || o.created_at > row.last) { row.last = o.created_at; row.name = o.customer_name || row.name }
      if (o.status !== 'cancelled') {
        row.orders += 1
        row.spent += Number(o.total ?? o.subtotal) || 0
        for (const it of o.order_items || []) {
          const id = String(it.product_id)
          row.productIds.add(id)
          const drop = productById[id]?.drop_name
          if (drop) row.drops.add(dropKey(drop))
        }
      }
      byPhone.set(key, row)
    }

    const list = [...byPhone.values()]
    const byEmail = new Map(list.filter((r) => r.email).map((r) => [r.email, r]))
    for (const s of subs) {
      const email = (s.email || '').trim().toLowerCase()
      if (!email) continue
      const match = byEmail.get(email)
      if (match) {
        match.subscribed = true
        match.joined = s.created_at || null
      } else {
        list.push({
          key: 'e:' + email, name: '', phone: '', email, orders: 0, spent: 0, last: null,
          productIds: new Set(), drops: new Set(), subscribed: true, joined: s.created_at || null,
        })
      }
    }
    return list.sort((a, b) => (b.last || b.joined || '').localeCompare(a.last || a.joined || ''))
  }, [orders, subs, productById])

  const drops = useMemo(() => {
    const seen = new Map()
    for (const p of products) if (p.drop_name && !seen.has(dropKey(p.drop_name))) seen.set(dropKey(p.drop_name), p.drop_name.trim())
    return [...seen.entries()]
  }, [products])

  const shown = people.filter((r) => {
    if (who === 'subscribed' && !r.subscribed) return false
    if (who === 'customers' && r.orders === 0) return false
    if (bought.startsWith('p:') && !r.productIds.has(bought.slice(2))) return false
    if (bought.startsWith('d:') && !r.drops.has(bought.slice(2))) return false
    const q = search.trim().toLowerCase()
    if (q && !`${r.name} ${r.phone} ${r.email}`.toLowerCase().includes(q)) return false
    return true
  })

  const chosen = shown.filter((r) => picked.has(r.key))
  const target = chosen.length ? chosen : shown
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.key))

  function toggle(key) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll() {
    setPicked(allPicked ? new Set() : new Set(shown.map((r) => r.key)))
  }

  async function copy(kind) {
    const values = [...new Set(target.map((r) => (kind === 'email' ? r.email : r.phone)).filter(Boolean))]
    if (!values.length) return setNote(`No ${kind === 'email' ? 'emails' : 'phone numbers'} in this list.`)
    try {
      await navigator.clipboard.writeText(values.join(kind === 'email' ? ', ' : '\n'))
      setNote(`Copied ${values.length} ${kind === 'email' ? 'email' : 'phone number'}${values.length === 1 ? '' : 's'}.`)
    } catch {
      setNote("Couldn't copy — your browser blocked it.")
    }
  }

  function download() {
    const head = ['Name', 'Phone', 'Email', 'Subscribed to news', 'Orders', 'Spent', 'Last order', 'Bought']
    const rows = target.map((r) => [
      r.name, r.phone, r.email, r.subscribed ? 'yes' : 'no', r.orders, r.spent, r.last ? r.last.slice(0, 10) : '',
      [...r.productIds].map((id) => productById[id]?.name || id).join('; '),
    ])
    const csv = [head, ...rows]
      .map((cols) => cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `pause-customers-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setNote(`Downloaded ${target.length} ${target.length === 1 ? 'person' : 'people'}.`)
  }

  const subCount = people.filter((r) => r.subscribed).length
  const custCount = people.filter((r) => r.orders > 0).length

  return (
    <section className="panel">
      <div className="panel-label mono" style={{ marginBottom: '6px' }}>CUSTOMERS &amp; EMAILS</div>
      <div className="panel-note" style={{ marginBottom: '16px' }}>
        Everyone on the mailing list (footer JOIN and checkout's "Email me with news and offers") and
        every customer who has ordered. Narrow the list, tick people (or none for the whole list), then
        copy their emails or phones, or download a CSV — import it into Brevo → Contacts to send a
        campaign. Only <strong>Subscribed</strong> people asked for news and offers by email.
      </div>

      {subsError && <div className="err-banner mono">{subsError}</div>}

      <div className="au-who mono">
        {[
          ['all', `All · ${people.length}`],
          ['subscribed', `Subscribed · ${subCount}`],
          ['customers', `Customers · ${custCount}`],
        ].map(([k, label]) => (
          <button key={k} type="button" className={who === k ? 'on' : ''} onClick={() => { setWho(k); setPicked(new Set()) }}>
            {label}
          </button>
        ))}
      </div>

      <div className="au-filters">
        <select value={bought} onChange={(e) => { setBought(e.target.value); setPicked(new Set()) }}>
          <option value="">Bought anything (or nothing)</option>
          {drops.length > 0 && (
            <optgroup label="Bought from a drop">
              {drops.map(([key, name]) => <option key={key} value={`d:${key}`}>{name}</option>)}
            </optgroup>
          )}
          <optgroup label="Bought a product">
            {products.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>{p.name}{p.variant ? ` — ${p.variant}` : ''}</option>
            ))}
          </optgroup>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone or email…" />
      </div>

      <div className="au-actions mono">
        <span className="au-count">
          {chosen.length ? `${chosen.length} selected` : `${shown.length} in this list`}
        </span>
        <button type="button" onClick={() => copy('email')}>Copy emails</button>
        <button type="button" onClick={() => copy('phone')}>Copy phones</button>
        <button type="button" onClick={download}>Download CSV</button>
        {note && <span className="au-note">{note}</span>}
      </div>

      {shown.length === 0 && <div className="empty mono">Nobody in this list yet.</div>}

      {shown.length > 0 && (
        <div className="au-table">
          <label className="au-row au-head mono">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select everyone shown" />
            <span>PERSON</span>
            <span>CONTACT</span>
            <span>ORDERS</span>
            <span>LAST</span>
          </label>
          {shown.map((r) => (
            <label className={`au-row ${picked.has(r.key) ? 'on' : ''}`} key={r.key}>
              <input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} />
              <span className="au-person">
                <span className="au-name">{r.name || 'Mailing list only'}</span>
                {r.subscribed && <span className="au-tag mono">SUBSCRIBED</span>}
              </span>
              <span className="au-contact mono">
                <span>{r.email || '—'}</span>
                <span className="dim">{r.phone || ''}</span>
              </span>
              <span className="mono">{r.orders ? `${r.orders} · ${taka(r.spent)}` : '—'}</span>
              <span className="mono dim">{day(r.last || r.joined)}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}
