import { useEffect, useMemo, useState } from 'react'
import InfoTip from './InfoTip.jsx'
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
// customer, in three steps:
//   1. Waiting for payment check — paste the TrxID from the bKash app;
//      verify_advance finds the order carrying it and marks it verified.
//   2. Verified — confirm to email: the matched order is highlighted with a
//      Confirm button. Only that button mails the customer their confirmation
//      (send-order-confirmation, which only mails a verified advance).
//   3. Recently confirmed.
// A TrxID that was verified before says which order it's on and highlights
// that order instead of just "already verified".
export default function BkashCheck({ orders, onChange }) {
  const [trx, setTrx] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, text }
  const [focus, setFocus] = useState(null) // the order id the last check matched
  const [confirming, setConfirming] = useState(null)

  const live = (o) => Number(o.advance_amount) > 0 && o.status !== 'cancelled' && o.status !== 'returned'

  const waiting = useMemo(
    () =>
      orders
        .filter((o) => live(o) && !o.advance_verified_at)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [orders]
  )

  const toConfirm = useMemo(
    () =>
      orders
        .filter((o) => live(o) && o.advance_verified_at && !o.customer_mail_sent_at)
        .sort((a, b) => new Date(b.advance_verified_at) - new Date(a.advance_verified_at)),
    [orders]
  )

  const recent = useMemo(
    () =>
      orders
        .filter((o) => Number(o.advance_amount) > 0 && o.advance_verified_at && o.customer_mail_sent_at)
        .sort((a, b) => new Date(b.customer_mail_sent_at) - new Date(a.customer_mail_sent_at))
        .slice(0, 10),
    [orders]
  )

  // The matched row scrolls into view, wherever it is.
  useEffect(() => {
    if (!focus) return
    requestAnimationFrame(() => {
      document.querySelector(`.bk-row[data-id="${focus}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [focus])

  async function verify(e) {
    e.preventDefault()
    const clean = cleanTrxId(trx)
    if (!clean) return

    setBusy(true)
    setResult(null)
    setFocus(null)

    const { data: orderId, error } = await supabase.rpc('verify_advance', { p_trx: clean })
    setBusy(false)

    if (error) {
      const raw = error.message || ''
      const again = raw.match(/ALREADY_VERIFIED:(\S+)/)
      if (again) {
        const o = orders.find((x) => x.id === again[1])
        setFocus(again[1])
        setTrx('')
        setResult({
          ok: true,
          text: o && !o.customer_mail_sent_at
            ? `Already verified — order ${again[1]} · ${o.customer_name}. It's highlighted below: press Confirm to email the customer.`
            : `Already verified and confirmed — order ${again[1]}${o ? ` · ${o.customer_name}` : ''}. Highlighted below.`,
        })
        return
      }
      setResult({ ok: false, text: explain(error) })
      return
    }

    const order = orders.find((o) => o.id === orderId)
    setTrx('')
    setFocus(orderId)
    onChange(orderId, { advance_verified_at: new Date().toISOString() })
    setResult({
      ok: true,
      text: `Payment matched — order ${orderId}${order ? ` · ${order.customer_name} · ${taka(order.advance_amount)}` : ''}. Check it below, then press Confirm to email the customer.`,
    })
  }

  // The customer hears from us only here.
  async function confirm(o) {
    setConfirming(o.id)
    const now = new Date().toISOString()

    if (!o.customer_email) {
      // Nothing to mail: just mark it done so it leaves the list.
      const { error } = await supabase.rpc('admin_mark_confirmed', { p_order_id: o.id })
      setConfirming(null)
      if (error) return setResult({ ok: false, text: "Couldn't save that — try again." })
      onChange(o.id, { customer_mail_sent_at: now })
      setResult({ ok: true, text: `${o.id} confirmed. No email on this order — call ${o.customer_phone} to let them know.` })
      return
    }

    const r = await sendOrderConfirmation(o.id)
    setConfirming(null)
    if (r?.sent?.customer) {
      onChange(o.id, { customer_mail_sent_at: now })
      setResult({ ok: true, text: `${o.id} confirmed — email sent to ${o.customer_email}.` })
    } else if (r?.skipped) {
      onChange(o.id, { customer_mail_sent_at: now })
      setResult({ ok: true, text: `${o.id} — the customer was already emailed earlier.` })
    } else {
      setResult({ ok: false, text: "The email didn't go out — check Brevo, then press Confirm again." })
    }
  }

  const head = (last) => (
    <div className="bk-row bk-th mono">
      <span>ORDER</span>
      <span>NAME</span>
      <span>PHONE</span>
      <span>EMAIL</span>
      <span>TRXID</span>
      <span>ADVANCE</span>
      <span>{last}</span>
    </div>
  )

  const cells = (o) => (
    <>
      <span className="mono">{o.id}</span>
      <span>{o.customer_name}</span>
      <span className="mono">{o.customer_phone}</span>
      <span className="bk-email">{o.customer_email || '—'}</span>
      <span className="mono bk-trx">{o.advance_trx_id || '—'}</span>
      <span className="mono">{taka(o.advance_amount)}</span>
    </>
  )

  return (
    <section className="panel bk">
      <div className="panel-label mono" style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        BKASH CHECK
        <InfoTip>
          <p><b>1.</b> Outside-Dhaka orders land in <b>Waiting for payment check</b>. The customer gets no email yet.</p>
          <p><b>2.</b> Copy the TrxID from your bKash app, paste it, press Verify. The matching order moves to <b>Verified — confirm</b>, highlighted.</p>
          <p><b>3.</b> Check the amount and name, then press <b>Confirm</b> — only then is the customer emailed their confirmation.</p>
          <p>Pasted a TrxID that was verified before? It tells you which order it's on and highlights it.</p>
        </InfoTip>
      </div>
      <div className="panel-note" style={{ marginBottom: '16px' }}>
        Paste the TrxID from your bKash app. A match is highlighted with a Confirm button — the customer is emailed only when you press it.
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
        VERIFIED — CONFIRM TO EMAIL THE CUSTOMER <span className="bk-count go">{toConfirm.length}</span>
        <InfoTip>Payment found in bKash. Press Confirm and the customer gets their order confirmation email. No email on the order? Confirm just clears it — call them instead.</InfoTip>
      </div>
      {toConfirm.length === 0 ? (
        <div className="empty mono">Nothing to confirm.</div>
      ) : (
        <div className="bk-table">
          {head('')}
          {toConfirm.map((o) => (
            <div className={`bk-row bk-ready ${focus === o.id ? 'bk-focus' : ''}`} key={o.id} data-id={o.id}>
              {cells(o)}
              <span>
                <button type="button" className="bk-confirm" disabled={confirming === o.id} onClick={() => confirm(o)}>
                  {confirming === o.id ? 'Sending…' : o.customer_email ? 'Confirm & email' : 'Confirm'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="bk-head mono">
        WAITING FOR PAYMENT CHECK <span className="bk-count">{waiting.length}</span>
      </div>

      {waiting.length === 0 ? (
        <div className="empty mono">Nothing waiting — every advance has been checked.</div>
      ) : (
        <div className="bk-table">
          {head('PLACED')}
          {waiting.map((o) => (
            <div className="bk-row" key={o.id} data-id={o.id}>
              {cells(o)}
              <span className="mono dim">{when(o.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <div className="bk-head mono" style={{ marginTop: '26px' }}>RECENTLY CONFIRMED</div>
          <div className="bk-table">
            {recent.map((o) => (
              <div className={`bk-row bk-done ${focus === o.id ? 'bk-focus' : ''}`} key={o.id} data-id={o.id}>
                {cells(o)}
                <span className="mono dim">✓ {when(o.customer_mail_sent_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
