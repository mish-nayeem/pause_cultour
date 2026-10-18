import { useEffect, useMemo, useState } from 'react'
import {
  SEEN_KEY,
  SINCE_KEY,
  fetchNoticeState,
  fetchOrdersAfter,
  saveNotice,
  saveNotices,
} from '../lib/notices.js'
import './notice-center.css'

// How often it checks for orders placed while the panel is open.
const POLL_MS = 60000
// The list keeps the newest this many.
const MAX_ITEMS = 60

function taka(n) {
  return '৳ ' + Number(n || 0).toLocaleString()
}

function when(iso) {
  const d = new Date(iso)
  return {
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }),
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
  }
}

// Admin → Overview: the bell. Every new order and every refund / exchange
// request from the Support page is a notification with its time, date and
// order number. The red count on the bell is what came in since the list was
// last opened — opening it clears that. Each notification keeps its own red
// dot until it's checked (tapped), and stays in the list, checked, until
// it's deleted.
export default function NoticeCenter({ orders, returns, onOpenOrder, onOpenRequests }) {
  const [state, setState] = useState(null) // Map | null while loading
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [later, setLater] = useState([]) // orders placed since the panel loaded

  useEffect(() => {
    fetchNoticeState().then(({ state, error }) => {
      if (error) setFailed(true)
      else setState(state)
    })
  }, [])

  // Orders placed after the newest one already loaded, checked once a minute.
  const newestLoaded = orders[0]?.created_at || null
  useEffect(() => {
    setLater([])
    if (!newestLoaded) return
    const id = setInterval(async () => {
      if (document.hidden) return
      const { orders: rows, error } = await fetchOrdersAfter(newestLoaded)
      if (!error) setLater(rows)
    }, POLL_MS)
    return () => clearInterval(id)
  }, [newestLoaded])

  const since = state?.get(SINCE_KEY)?.read_at || null
  const seen = state?.get(SEEN_KEY)?.read_at || since

  const items = useMemo(() => {
    if (!state || !since) return []
    const list = []
    const known = new Set()
    for (const o of [...later, ...orders]) {
      if (known.has(o.id) || o.created_at <= since) continue
      known.add(o.id)
      list.push({
        key: `order:${o.id}`,
        kind: 'order',
        at: o.created_at,
        orderId: o.id,
        title: 'New order',
        detail: [o.customer_name, taka(o.total ?? o.subtotal)].filter(Boolean).join(' · '),
      })
    }
    for (const r of returns) {
      if (r.source !== 'customer' || r.created_at <= since) continue
      list.push({
        key: `return:${r.id}`,
        kind: r.kind === 'refund' ? 'refund' : 'exchange',
        at: r.created_at,
        orderId: r.order_id,
        title: r.kind === 'refund' ? 'Refund request' : 'Exchange request',
        detail: [r.orders?.customer_name, r.reason].filter(Boolean).join(' · '),
      })
    }
    return list
      .filter((n) => !state.get(n.key)?.dismissed_at)
      .map((n) => ({ ...n, read: !!state.get(n.key)?.read_at }))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, MAX_ITEMS)
  }, [state, since, orders, later, returns])

  const fresh = items.filter((n) => !n.read && n.at > seen).length
  const unread = items.filter((n) => !n.read).length

  function patchLocal(rows) {
    setState((prev) => {
      const next = new Map(prev)
      for (const r of rows) next.set(r.key, { ...next.get(r.key), ...r })
      return next
    })
  }

  function toggle() {
    const opening = !open
    setOpen(opening)
    if (opening) {
      // Opening the list is having seen what's in it — the bell's count goes.
      const row = { key: SEEN_KEY, read_at: new Date().toISOString() }
      patchLocal([row])
      saveNotice(SEEN_KEY, { read_at: row.read_at })
    }
  }

  function check(n) {
    if (n.read) return
    const row = { key: n.key, read_at: new Date().toISOString() }
    patchLocal([row])
    saveNotice(n.key, { read_at: row.read_at })
  }

  function openIt(n) {
    check(n)
    if (n.kind === 'order') onOpenOrder(n.orderId)
    else onOpenRequests()
  }

  function remove(n) {
    const now = new Date().toISOString()
    const row = { key: n.key, dismissed_at: now, read_at: state.get(n.key)?.read_at || now }
    patchLocal([row])
    saveNotice(n.key, { dismissed_at: row.dismissed_at, read_at: row.read_at })
  }

  function checkAll() {
    const now = new Date().toISOString()
    const rows = items.filter((n) => !n.read).map((n) => ({ key: n.key, read_at: now }))
    patchLocal(rows)
    saveNotices(rows)
  }

  function clearChecked() {
    const now = new Date().toISOString()
    const rows = items.filter((n) => n.read).map((n) => ({ key: n.key, dismissed_at: now, read_at: state.get(n.key)?.read_at || now }))
    patchLocal(rows)
    saveNotices(rows)
  }

  if (failed) {
    return (
      <div className="nc-fail mono">
        Notifications need supabase-migration-admin-notices.sql — run it in the Supabase SQL Editor.
      </div>
    )
  }

  return (
    <div className="nc">
      <button type="button" className={`nc-bell ${open ? 'on' : ''}`} onClick={toggle} aria-expanded={open}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span>Notifications</span>
        {fresh > 0 && <span className="nc-count mono">{fresh}</span>}
        {fresh === 0 && unread > 0 && <span className="nc-unread mono">{unread} unchecked</span>}
      </button>

      {open && (
        <div className="nc-panel">
          <div className="nc-head mono">
            <span>{items.length ? `${items.length} notification${items.length === 1 ? '' : 's'}` : 'NOTIFICATIONS'}</span>
            <span className="nc-tools">
              {unread > 0 && <button type="button" onClick={checkAll}>Check all</button>}
              {items.some((n) => n.read) && <button type="button" onClick={clearChecked}>Delete checked</button>}
            </span>
          </div>

          {state === null && <div className="nc-empty mono">Loading…</div>}
          {state && items.length === 0 && (
            <div className="nc-empty mono">Nothing yet — new orders and refund / exchange requests show up here.</div>
          )}

          <ul className="nc-list">
            {items.map((n) => {
              const t = when(n.at)
              return (
                <li key={n.key} className={`nc-item ${n.kind} ${n.read ? 'read' : ''}`}>
                  <button type="button" className="nc-main" onClick={() => check(n)} title={n.read ? 'Checked' : 'Tap to mark as checked'}>
                    <span className="nc-dot" aria-label={n.read ? 'Checked' : 'Not checked'} />
                    <span className="nc-body">
                      <span className="nc-title">
                        {n.title} <span className="nc-id mono">{n.orderId}</span>
                      </span>
                      <span className="nc-when mono">{t.time} · {t.date}</span>
                      {n.detail && <span className="nc-detail">{n.detail}</span>}
                    </span>
                  </button>
                  <span className="nc-actions">
                    <button type="button" className="nc-open mono" onClick={() => openIt(n)}>Open →</button>
                    <button type="button" className="nc-del" onClick={() => remove(n)} aria-label="Delete notification">✕</button>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
