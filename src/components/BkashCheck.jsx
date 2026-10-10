import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { sendOrderConfirmation } from '../lib/email.js'
import { cleanTrxId } from '../lib/delivery.js'
import './bkash-check.css'

function taka(n) {
  return '৳ ' + Number(n || 0).toLocaleString()
}

function when(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// verify_advance's tagged errors, said plainly.
function explain(error) {
  const raw = error?.message || ''
  let m
  if (raw.includes('TRX_NOT_FOUND')) return 'No order has this TrxID. Check it was copied whole.'
  if ((m = raw.match(/ALREADY_VERIFIED:(\S+)/))) return `Already verified — order ${m[1]}.`
  if ((m = raw.match(/ORDER_CANCELLED:(\S+)/))) return `This TrxID is on order ${m[1]}, which is cancelled.`
  if (raw.includes('NOT_ALLOWED')) return 'Only the admin account can verify payments.'
  return 'Could not check that right now — try again.'
}

// Orders → bKash check. Outside-Dhaka orders wait here, unconfirmed to the
// customer, until the admin pastes the same TrxID from the bKash app. A match
// marks the advance verified (verify_advance) and sends the customer their
// confirmation (send-order-confirmation, which only mails a verified advance).
export default function BkashCheck({ orders, onChange }) {
  const [trx, setTrx] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, text }

  const waiting = useMemo(
    () =>
      orders
        .filter((o) => Number(o.advance_amount) > 0 && !o.advance_verified_at && o.status !== 'cancelled')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [orders]
  )

  const recent = useMemo(
    () =>
      orders
        .filter((o) => Number(o.advance_amount) > 0 && o.advance_verified_at)
        .sort((a, b) => new Date(b.advance_verified_at) - new Date(a.advance_verified_at))
        .slice(0, 10),
    [orders]
  )

  async function verify(e) {
    e.preventDefault()
    const clean = cleanTrxId(trx)
    if (!clean) return

    setBusy(true)
    setResult(null)

    const { data: orderId, error } = await supabase.rpc('verify_advance', { p_trx: clean })

    if (error) {
      setBusy(false)
      setResult({ ok: false, text: explain(error) })
      return
    }

    const order = orders.find((o) => o.id === orderId)
    const mail = order?.customer_email ? await sendOrderConfirmation(orderId) : null

    setBusy(false)
    setTrx('')
    const now = new Date().toISOString()
    onChange(orderId, {
      advance_verified_at: now,
      ...(mail?.sent?.customer ? { customer_mail_sent_at: now } : {}),
    })

    const who = order ? `${order.customer_name} · ${taka(order.advance_amount)}` : ''
    let tail = 'No email on this order — call to confirm.'
    if (order?.customer_email) {
      tail = mail?.sent?.customer
        ? `Confirmation email sent to ${order.customer_email}.`
        : mail?.skipped
          ? 'The customer was already emailed earlier.'
          : "Verified, but the email didn't go out — check Brevo, then use Resend below."
    }
    setResult({ ok: true, text: `Matched ${orderId} — ${who}. ${tail}` })
  }

  return (
    <section className="panel bk">
      <div className="panel-label mono" style={{ marginBottom: '6px' }}>BKASH CHECK</div>
      <div className="panel-note" style={{ marginBottom: '16px' }}>
        Outside-Dhaka orders wait here until their advance is confirmed. Copy the
        TrxID from your bKash app and paste it below — if it matches an order,
        that customer gets their confirmation email.
      </div>

      <form className="bk-form" onSubmit={verify}>
        <input
          value={trx}
          onChange={(e) => setTrx(e.target.value)}
          placeholder="Paste TrxID from the bKash app"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
        />
        <button type="submit" disabled={busy || !cleanTrxId(trx)}>
          {busy ? 'Checking…' : 'Verify'}
        </button>
      </form>

      {result && <div className={`bk-result ${result.ok ? 'ok' : 'bad'}`}>{result.text}</div>}

      <div className="bk-head mono">
        WAITING FOR PAYMENT CHECK <span className="bk-count">{waiting.length}</span>
      </div>

      {waiting.length === 0 ? (
        <div className="empty mono">Nothing waiting — every advance has been checked.</div>
      ) : (
        <div className="bk-table">
          <div className="bk-row bk-th mono">
            <span>ORDER</span>
            <span>NAME</span>
            <span>PHONE</span>
            <span>EMAIL</span>
            <span>TRXID</span>
            <span>ADVANCE</span>
            <span>PLACED</span>
          </div>
          {waiting.map((o) => (
            <div className="bk-row" key={o.id}>
              <span className="mono">{o.id}</span>
              <span>{o.customer_name}</span>
              <span className="mono">{o.customer_phone}</span>
              <span className="bk-email">{o.customer_email || '—'}</span>
              <span className="mono bk-trx">{o.advance_trx_id || '—'}</span>
              <span className="mono">{taka(o.advance_amount)}</span>
              <span className="mono dim">{when(o.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <div className="bk-head mono" style={{ marginTop: '26px' }}>RECENTLY VERIFIED</div>
          <div className="bk-table">
            {recent.map((o) => (
              <div className="bk-row bk-done" key={o.id}>
                <span className="mono">{o.id}</span>
                <span>{o.customer_name}</span>
                <span className="mono">{o.customer_phone}</span>
                <span className="bk-email">{o.customer_email || '—'}</span>
                <span className="mono bk-trx">{o.advance_trx_id}</span>
                <span className="mono">{taka(o.advance_amount)}</span>
                <span className="mono dim">
                  {o.customer_email && !o.customer_mail_sent_at ? (
                    <button
                      type="button"
                      className="bk-resend"
                      onClick={async () => {
                        const r = await sendOrderConfirmation(o.id)
                        setResult(
                          r?.sent?.customer
                            ? { ok: true, text: `Confirmation email sent to ${o.customer_email}.` }
                            : { ok: false, text: "Still couldn't send — check Brevo." }
                        )
                        if (r?.sent?.customer) onChange(o.id, { customer_mail_sent_at: new Date().toISOString() })
                      }}
                    >
                      Resend email
                    </button>
                  ) : (
                    `✓ ${when(o.advance_verified_at)}`
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
