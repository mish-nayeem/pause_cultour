import { useState } from 'react'
import InfoTip from './InfoTip.jsx'
import { COURIERS } from '../lib/courier.js'
import './bulk-bar.css'

const MARKS = [
  { key: 'shipped', label: 'Mark shipped' },
  { key: 'delivered', label: 'Mark delivered' },
  { key: 'returned', label: 'Mark returned' },
  { key: 'cancelled', label: 'Cancel' },
]

// Orders → Select: the bar along the bottom while orders are ticked. Every
// action works on the ticked orders only; changing a status asks first,
// because it emails each customer.
export default function BulkBar({ count, shown, busy, note, onAll, onNone, onMark, onPrint, onCourier, onExit }) {
  const [asking, setAsking] = useState(null) // a MARKS key, or 'courier'
  const [courier, setCourier] = useState(COURIERS[0].key)

  const label = MARKS.find((m) => m.key === asking)?.label

  return (
    <div className="bulk-bar">
      <div className="bulk-top">
        <span className="bulk-count mono">
          <b>{count}</b> selected
          <InfoTip>
            <p>Tap order cards to tick them, then act on all of them at once.</p>
            <p><b>Mark shipped / delivered / Cancel</b> — changes each one's status and emails the customer, the same as changing it by hand.</p>
            <p><b>Mark returned</b> — the courier brought the parcels back (customer unreachable or refused). The pieces go back into stock; no email.</p>
            <p><b>Print slips</b> — one packing slip per order, each on its own page.</p>
            <p><b>Courier</b> — books every ticked order that isn't booked yet. Works once the courier's API keys are added (Orders → Courier setup).</p>
          </InfoTip>
        </span>
        <span className="bulk-links mono">
          <button type="button" onClick={onAll}>All {shown}</button>
          <button type="button" onClick={onNone} disabled={!count}>None</button>
          <button type="button" onClick={onExit}>Done</button>
        </span>
      </div>

      {note && <div className="bulk-note mono">{note}</div>}

      {asking ? (
        <div className="bulk-ask mono">
          <span>
            {asking === 'courier'
              ? `Book ${count} order${count === 1 ? '' : 's'} with ${COURIERS.find((c) => c.key === courier)?.label}?`
              : `${label} — ${count} order${count === 1 ? '' : 's'}?${asking === 'returned' ? ' Their pieces go back into stock.' : ' Each customer gets an email.'}`}
          </span>
          <button
            type="button"
            className="ab-yes"
            onClick={() => {
              const what = asking
              setAsking(null)
              if (what === 'courier') onCourier(courier)
              else onMark(what)
            }}
          >
            Yes
          </button>
          <button type="button" className="ab-no" onClick={() => setAsking(null)}>No</button>
        </div>
      ) : (
        <div className="bulk-actions mono">
          {MARKS.map((m) => (
            <button key={m.key} type="button" className={`bulk-btn ${m.key}`} disabled={!count || busy} onClick={() => setAsking(m.key)}>
              {m.label}
            </button>
          ))}
          <button type="button" className="bulk-btn" disabled={!count || busy} onClick={onPrint}>Print slips</button>
          <span className="bulk-courier">
            <select value={courier} onChange={(e) => setCourier(e.target.value)} disabled={busy}>
              {COURIERS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <button type="button" className="bulk-btn" disabled={!count || busy} onClick={() => setAsking('courier')}>
              Send to courier
            </button>
          </span>
        </div>
      )}
      {busy && <div className="bulk-note mono">{busy}</div>}
    </div>
  )
}
