import { useMemo } from 'react'
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'
import { stockMap, LOW_STOCK_AT } from '../lib/stock.js'
import './today-panel.css'

function taka(n) {
  return '৳ ' + Math.round(Number(n || 0)).toLocaleString()
}

const DAY = 86400e3

// Midnight today, in the browser's own time (Dhaka for the shop).
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function ago(iso) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

// Up or down against yesterday, as a small word — "+3 vs yesterday".
function versus(now, before, money = false) {
  const diff = now - before
  if (!before && !now) return 'Nothing yesterday either'
  if (diff === 0) return 'Same as yesterday'
  const v = money ? taka(Math.abs(diff)) : Math.abs(diff)
  return `${diff > 0 ? '▲' : '▼'} ${v} vs yesterday`
}

// Overview → Today. The morning look: what came in today against yesterday,
// what's waiting to be packed and how long it's been waiting, what's on its
// way, return requests to answer and sizes running out — each a way into
// the list behind it.
export default function TodayPanel({ orders, products, returns, newRequests = 0, onOpenOrders, onOpenOrder, onOpenRequests, onOpenStock }) {
  const t = useMemo(() => {
    const today = startOfToday()
    const yesterday = today - DAY
    const live = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'returned')
    const at = (o) => new Date(o.created_at).getTime()
    const todays = live.filter((o) => at(o) >= today)
    const yesterdays = live.filter((o) => at(o) >= yesterday && at(o) < today)
    const value = (list) => list.reduce((n, o) => n + Number(o.total ?? o.subtotal ?? 0), 0)

    const pending = orders.filter((o) => o.status === 'pending').sort((a, b) => at(a) - at(b))
    const late = pending.filter((o) => Date.now() - at(o) > DAY)
    const shipped = orders.filter((o) => o.status === 'shipped')

    // Sizes at LOW_STOCK_AT or under, and the ones already at 0.
    let low = 0
    let out = 0
    for (const p of products) {
      const map = stockMap(p)
      if (!map) continue
      for (const s of p.sizes || []) {
        const n = map[s] ?? 0
        if (n === 0) out++
        else if (n <= LOW_STOCK_AT) low++
      }
    }

    return {
      todays: [...todays].sort((a, b) => at(b) - at(a)),
      count: todays.length,
      countBefore: yesterdays.length,
      value: value(todays),
      valueBefore: value(yesterdays),
      pieces: todays.reduce((n, o) => n + (o.order_items || []).reduce((m, it) => m + Number(it.qty || 0), 0), 0),
      pending,
      late,
      shipped,
      low,
      out,
    }
  }, [orders, products])

  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="today">
      <div className="today-head">
        <div>
          <div className="today-date mono">{dateLine}</div>
          <div className="today-hello">
            {t.pending.length
              ? `${t.pending.length} order${t.pending.length === 1 ? '' : 's'} to pack${t.late.length ? ` — ${t.late.length} waiting over a day` : ''}.`
              : 'Nothing waiting to be packed.'}
          </div>
        </div>
        <InfoTip>
          <p>Today at a glance, from midnight. Cancelled orders don't count.</p>
          <p>Every box opens the list behind it — tap Pending to start packing.</p>
        </InfoTip>
      </div>

      {/* ---- The numbers ---- */}
      <div className="today-cards">
        <button type="button" className="today-card" onClick={() => onOpenOrders('all')}>
          <span className="today-label mono">
            ORDERS TODAY
            <InfoTip>New orders since midnight, website and DM alike, cancelled ones left out.</InfoTip>
          </span>
          <strong>{t.count}</strong>
          <em className={`mono ${t.count >= t.countBefore ? 'up' : 'down'}`}>{versus(t.count, t.countBefore)}</em>
        </button>

        <div className="today-card">
          <span className="today-label mono">
            SALES TODAY
            <InfoTip>What today's orders add up to (with delivery, less discounts) — not yet collected; cash comes in at delivery.</InfoTip>
          </span>
          <strong>{taka(t.value)}</strong>
          <em className={`mono ${t.value >= t.valueBefore ? 'up' : 'down'}`}>{versus(t.value, t.valueBefore, true)}</em>
        </div>

        <button type="button" className={`today-card ${t.late.length ? 'warn' : ''}`} onClick={() => onOpenOrders('pending')}>
          <span className="today-label mono">
            TO PACK & SHIP
            <InfoTip>Orders still pending — not shipped yet. Red when one has waited more than a day. Open the list, then use Select to mark several shipped or print their slips at once.</InfoTip>
          </span>
          <strong>{t.pending.length}</strong>
          <em className="mono">{t.pending.length ? `oldest ${ago(t.pending[0].created_at)}` : 'All caught up'}</em>
        </button>

        <button type="button" className="today-card" onClick={() => onOpenOrders('shipped')}>
          <span className="today-label mono">
            ON THE WAY
            <InfoTip>Shipped, not delivered yet. Mark them delivered when the courier confirms — that's when the money counts as collected.</InfoTip>
          </span>
          <strong>{t.shipped.length}</strong>
          <em className="mono">with the courier</em>
        </button>

        <button type="button" className={`today-card ${newRequests ? 'warn' : ''}`} onClick={onOpenRequests}>
          <span className="today-label mono">
            RETURN REQUESTS
            <InfoTip>New return or exchange requests from the Support portal that haven't been opened yet.</InfoTip>
          </span>
          <strong>{newRequests}</strong>
          <em className="mono">{newRequests ? 'waiting for an answer' : 'none new'}</em>
        </button>

        <button type="button" className={`today-card ${t.out ? 'warn' : ''}`} onClick={onOpenStock}>
          <span className="today-label mono">
            SIZES RUNNING OUT
            <InfoTip>Sizes with {LOW_STOCK_AT} or fewer left, and sizes sold out — opens Stock levels.</InfoTip>
          </span>
          <strong>{t.low + t.out}</strong>
          <em className="mono">{t.out} sold out · {t.low} low</em>
        </button>
      </div>

      <div className="ab-grid">
        {/* ---- Waiting longest ---- */}
        <AdminBox
          title="WAITING LONGEST"
          side={t.pending.length ? `${t.pending.length} pending` : ''}
          tip="Pending orders, oldest first — the ones to pack next. Tap one to open it."
        >
          {t.pending.length === 0 ? (
            <div className="ab-empty mono">Nothing pending — every order is on its way.</div>
          ) : (
            <div className="today-list">
              {t.pending.slice(0, 6).map((o) => (
                <button type="button" className={`today-row ${Date.now() - new Date(o.created_at).getTime() > DAY ? 'late' : ''}`} key={o.id} onClick={() => onOpenOrder(o.id)}>
                  <span className="today-who">
                    <b>{o.customer_name}</b>
                    <span className="mono">{o.id} · {o.customer_area}</span>
                  </span>
                  <span className="today-right mono">
                    <b>{taka(o.total ?? o.subtotal)}</b>
                    <span>{ago(o.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </AdminBox>

        {/* ---- Today's orders ---- */}
        <AdminBox
          title="TODAY'S ORDERS"
          side={t.count ? `${t.pieces} piece${t.pieces === 1 ? '' : 's'}` : ''}
          tip="Every order placed since midnight, newest first. Tap one to open it."
        >
          {t.todays.length === 0 ? (
            <div className="ab-empty mono">No orders yet today.</div>
          ) : (
            <div className="today-list">
              {t.todays.slice(0, 6).map((o) => (
                <button type="button" className="today-row" key={o.id} onClick={() => onOpenOrder(o.id)}>
                  <span className="today-who">
                    <b>{o.customer_name}</b>
                    <span className="mono">{o.id} · {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                  <span className="today-right mono">
                    <b>{taka(o.total ?? o.subtotal)}</b>
                    <span className={`today-status ${o.status}`}>{o.status}</span>
                  </span>
                </button>
              ))}
              {t.todays.length > 6 && (
                <button type="button" className="today-more mono" onClick={() => onOpenOrders('all')}>
                  + {t.todays.length - 6} more today →
                </button>
              )}
            </div>
          )}
        </AdminBox>
      </div>
    </div>
  )
}
