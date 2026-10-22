import { useEffect, useMemo, useRef, useState } from 'react'
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'
import { listDrops, dropFigures, fetchDropCosts, addDropCost, deleteDropCost } from '../lib/dropMoney.js'
import { dropKey } from '../lib/lookbook.js'
import { openPrintPage } from '../lib/printPage.js'
import './investor-report.css'
import './drop-profit.css'

const DAY = 86400e3

function taka(n) {
  const v = Math.round(Number(n || 0))
  return (v < 0 ? '− ' : '') + '৳ ' + Math.abs(v).toLocaleString()
}

function toInput(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function day(s) {
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const today = () => toInput(new Date())

// Products → Cost & margin → Drop profit. Pick a drop: what it sold comes
// from the orders by itself (coupons and sale prices included); what it
// cost — ads by date, and anything else by name — is typed in here whenever.
// Profit = revenue that reached the shop − those costs. Download PDF for
// the whole sheet.
export default function DropProfit({ orders, products }) {
  const drops = useMemo(() => listDrops(products), [products])
  const [pick, setPick] = useState('')
  const drop = drops.find((d) => d.key === pick) || drops[0] || null
  const [costs, setCosts] = useState([])
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(today())
  const [useUnitCost, setUseUnitCost] = useState(false)
  const [ad, setAd] = useState({ spent_on: today(), amount: '', label: '' })
  const [other, setOther] = useState({ spent_on: today(), amount: '', label: '' })
  const [busy, setBusy] = useState(false)
  const [askDel, setAskDel] = useState(null)
  const previewRef = useRef(null)

  useEffect(() => {
    fetchDropCosts().then(({ costs, error }) => {
      setCosts(costs)
      setError(error || '')
    })
  }, [])

  const mine = useMemo(() => (drop ? costs.filter((c) => dropKey(c.drop_name) === drop.key) : []), [costs, drop])

  // A new drop: the range opens on whichever came first — its launch or
  // its first cost (production is often paid before launch) — up to today.
  useEffect(() => {
    if (!drop) return
    const firstCost = mine.length ? new Date(mine[0].spent_on).getTime() : Infinity
    const start = Math.min(Number.isFinite(drop.start) ? drop.start : Date.now(), firstCost)
    setFrom(toInput(new Date(start)))
    setTo(today())
    // Only when the drop changes, not on every cost added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop?.key])

  const fromMs = from ? new Date(from + 'T00:00:00').getTime() : 0
  const toMs = to ? new Date(to + 'T00:00:00').getTime() + DAY : Date.now() + DAY
  const inRange = (c) => {
    const t = new Date(c.spent_on + 'T00:00:00').getTime()
    return t >= fromMs && t < toMs
  }

  const f = useMemo(() => (drop ? dropFigures(orders, drop, fromMs, toMs) : null), [orders, drop, fromMs, toMs])
  const ads = mine.filter((c) => c.kind === 'ads' && inRange(c))
  const others = mine.filter((c) => c.kind === 'other' && inRange(c))
  const adTotal = ads.reduce((n, c) => n + Number(c.amount), 0)
  const otherTotal = others.reduce((n, c) => n + Number(c.amount), 0)
  const outside = mine.filter((c) => !inRange(c)).length
  const unit = useUnitCost && f ? f.unitCost : 0
  const profit = f ? f.revenue - adTotal - otherTotal - unit : 0
  const roas = adTotal ? (f?.sales || 0) / adTotal : null

  async function add(kind, draft, reset) {
    const amount = Number(draft.amount)
    if (!drop) return
    if (!(amount > 0)) return setError('Enter an amount.')
    if (kind === 'other' && !draft.label.trim()) return setError('Name the cost — e.g. Production, Shoot.')
    if (!draft.spent_on) return setError('Pick the date.')
    setBusy(true)
    setError('')
    const { cost, error } = await addDropCost({ drop_name: drop.name, kind, amount, spent_on: draft.spent_on, label: draft.label.trim() || null })
    setBusy(false)
    if (error) return setError(error)
    setCosts((list) => [...list, cost].sort((a, b) => String(a.spent_on).localeCompare(String(b.spent_on))))
    // A cost from before the range (production before launch): open the
    // range back to it, so it counts.
    if (from && draft.spent_on < from) setFrom(draft.spent_on)
    reset()
  }

  async function remove(id) {
    setBusy(true)
    const { error } = await deleteDropCost(id)
    setBusy(false)
    setAskDel(null)
    if (error) return setError(error)
    setCosts((list) => list.filter((c) => c.id !== id))
  }

  function downloadPdf() {
    if (!drop) return
    const ok = openPrintPage({ title: `PAUSE ${drop.name} profit · ${day(from)} – ${day(to)}`, html: previewRef.current?.innerHTML })
    if (!ok) setError('Your browser blocked the new tab — allow pop-ups for this site, then press Download PDF again.')
  }

  if (!drops.length) {
    return <div className="empty mono">No drops yet — give products a Drop name first (Products → edit → Drop).</div>
  }

  const costRow = (c) => (
    <div className="dp-cost" key={c.id}>
      <span className="mono">{day(c.spent_on)}</span>
      <span>{c.label || (c.kind === 'ads' ? 'Ads' : '—')}</span>
      <b className="mono">{taka(c.amount)}</b>
      {askDel === c.id ? (
        <span className="dp-ask">
          <button type="button" className="ab-yes" disabled={busy} onClick={() => remove(c.id)}>Delete</button>
          <button type="button" className="ab-no" onClick={() => setAskDel(null)}>No</button>
        </span>
      ) : (
        <button type="button" className="dp-x" aria-label="Delete this cost" onClick={() => setAskDel(c.id)}>✕</button>
      )}
    </div>
  )

  const products_ = f ? [...f.byProduct.entries()].sort((a, b) => b[1].value - a[1].value) : []

  return (
    <div className="dp">
      {error && <div className="ab-warn mono">{error}</div>}

      <AdminBox
        wide
        title="DROP PROFIT"
        tip={
          <>
            <p><b>Sales come in by themselves</b> from the orders of this drop's products — sale prices and coupons included (a coupon on a mixed order is split by value).</p>
            <p><b>Revenue</b> = what reached you: delivered pieces less the courier's 1%, less any returned parcel's unpaid delivery or 2nd parcel you paid. Delivery charges aren't revenue — the courier keeps them.</p>
            <p><b>Costs you add here</b> whenever: ads by date, and anything else by name (production, shoot, packaging…).</p>
            <p><b>Profit</b> = revenue − ads − other costs.</p>
          </>
        }
      >
        <div className="dp-controls">
          <label className="ab-label mono">
            DROP
            <select className="ab-input" value={drop?.key || ''} onChange={(e) => setPick(e.target.value)}>
              {drops.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
          </label>
          <label className="ab-label mono">
            FROM
            <input type="date" className="ab-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="ab-label mono">
            TO
            <input type="date" className="ab-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="ab-btn" onClick={downloadPdf}>Download PDF</button>
        </div>
        <div className="dp-hint mono">
          Starts on the drop's launch, or its first cost if that came earlier. Sales and costs inside these dates count.
          {outside > 0 && ` ${outside} cost${outside === 1 ? ' is' : 's are'} outside the dates and not counted.`}
        </div>
      </AdminBox>

      {drop && f && (
        <>
          <div className="ab-grid">
            <AdminBox
              title="ADD AD SPEND"
              tip="Money spent on ads for this drop, on a day — e.g. 7 Oct ৳2,000, 12 Oct ৳4,000. Add one row per day or per boost. Where (Facebook, Instagram…) is optional."
            >
              <form className="dp-form" onSubmit={(e) => { e.preventDefault(); add('ads', ad, () => setAd({ spent_on: ad.spent_on, amount: '', label: ad.label })) }}>
                <input type="date" className="ab-input" value={ad.spent_on} onChange={(e) => setAd({ ...ad, spent_on: e.target.value })} aria-label="Date" />
                <input className="ab-input" inputMode="numeric" placeholder="Amount ৳" value={ad.amount} onChange={(e) => setAd({ ...ad, amount: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Amount" />
                <input className="ab-input" placeholder="Where (optional) — Facebook" value={ad.label} onChange={(e) => setAd({ ...ad, label: e.target.value })} aria-label="Where" />
                <button type="submit" className="ab-btn" disabled={busy}>Add</button>
              </form>
              <div className="dp-list">
                {ads.length === 0 ? <div className="ab-empty mono">No ad spend in these dates.</div> : ads.map(costRow)}
              </div>
              <div className="dp-total mono">Ads total <b>{taka(adTotal)}</b></div>
            </AdminBox>

            <AdminBox
              title="ADD OTHER COSTS"
              tip="Any other cost of this drop, with its name, amount and date — Production, Shoot, Model, Packaging, Printing… Production is usually paid before launch; the dates above open early enough to include it."
            >
              <form className="dp-form" onSubmit={(e) => { e.preventDefault(); add('other', other, () => setOther({ spent_on: other.spent_on, amount: '', label: '' })) }}>
                <input className="ab-input" placeholder="Name — Production, Shoot…" value={other.label} onChange={(e) => setOther({ ...other, label: e.target.value })} aria-label="Cost name" />
                <input className="ab-input" inputMode="numeric" placeholder="Amount ৳" value={other.amount} onChange={(e) => setOther({ ...other, amount: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Amount" />
                <input type="date" className="ab-input" value={other.spent_on} onChange={(e) => setOther({ ...other, spent_on: e.target.value })} aria-label="Date" />
                <button type="submit" className="ab-btn" disabled={busy}>Add</button>
              </form>
              <div className="dp-list">
                {others.length === 0 ? <div className="ab-empty mono">No other costs in these dates.</div> : others.map(costRow)}
              </div>
              <div className="dp-total mono">Other costs total <b>{taka(otherTotal)}</b></div>
              {f.unitCost > 0 && (
                <label className="ab-switch mono dp-unit">
                  <input type="checkbox" checked={useUnitCost} onChange={(e) => setUseUnitCost(e.target.checked)} />
                  Also count each piece's own cost (Cost &amp; margin): {taka(f.unitCost)}
                  <InfoTip>Tick only if you haven't typed the production cost in above — otherwise it's counted twice.</InfoTip>
                </label>
              )}
            </AdminBox>
          </div>

          <div className="ir-preview-label mono">THE SHEET (THIS IS WHAT THE PDF SHOWS)</div>
          <div className="ir-preview" ref={previewRef}>
            <div className="ir-paper">
              <header className="ir-head">
                <div>
                  <div className="ir-brand">PAUSE</div>
                  <div className="ir-title">Drop profit · {drop.name} · {day(from)} – {day(to)}</div>
                </div>
                <div className="ir-meta">
                  <div>Prepared {day(new Date())}</div>
                  {Number.isFinite(drop.start) && <div>Drop launched {day(drop.start)}</div>}
                </div>
              </header>

              <section className="ir-kpis">
                {[
                  ['Sales', taka(f.sales), `${f.orders} orders · ${f.pieces} pieces`],
                  ['Revenue (reached the shop)', taka(f.revenue), f.toCollect ? `+ ${taka(f.toCollect)} still to collect` : 'all collected'],
                  ['Costs', taka(adTotal + otherTotal + unit), `ads ${taka(adTotal)} · other ${taka(otherTotal + unit)}`],
                  ['Profit', taka(profit), f.revenue ? `${Math.round((profit / f.revenue) * 100)}% of revenue` : '—'],
                  ['Ad return (ROAS)', roas == null ? '—' : `${roas.toFixed(1)}×`, roas == null ? 'no ad spend yet' : 'sales ÷ ad spend'],
                  ['Discounts given', taka(f.discounts), 'coupons on these orders'],
                ].map(([label, v, sub]) => (
                  <div className={`ir-kpi ${label === 'Profit' ? (profit >= 0 ? 'dp-win' : 'dp-loss') : ''}`} key={label}>
                    <div className="ir-kpi-label">{label}</div>
                    <div className="ir-kpi-value">{v}</div>
                    <div className="ir-kpi-change"><span>{sub}</span></div>
                  </div>
                ))}
              </section>

              <section className="ir-block">
                <div className="ir-label">PROFIT, LINE BY LINE</div>
                <table className="ir-table">
                  <tbody>
                    <tr><td>Pieces sold, at the price they sold at</td><td>{taka(f.listValue)}</td></tr>
                    <tr className="ir-sub"><td>Coupons / offers</td><td>− {taka(f.discounts)}</td></tr>
                    <tr><td>Sales</td><td>{taka(f.sales)}</td></tr>
                    <tr className="ir-sub"><td>Still on the way / being packed</td><td>− {taka(f.sales - f.delivered)}</td></tr>
                    <tr><td>Delivered and collected</td><td>{taka(f.delivered)}</td></tr>
                    <tr className="ir-sub"><td>Courier — 1% COD</td><td>− {taka(f.codFee)}</td></tr>
                    {f.shopPaidParcels > 0 && <tr className="ir-sub"><td>Returned / 2nd parcels we paid</td><td>− {taka(f.shopPaidParcels)}</td></tr>}
                    <tr><td><b>Revenue</b></td><td><b>{taka(f.revenue)}</b></td></tr>
                    <tr className="ir-sub"><td>Ads</td><td>− {taka(adTotal)}</td></tr>
                    {others.map((c) => (
                      <tr className="ir-sub" key={c.id}><td>{c.label}</td><td>− {taka(c.amount)}</td></tr>
                    ))}
                    {unit > 0 && <tr className="ir-sub"><td>Pieces' own cost (Cost &amp; margin)</td><td>− {taka(unit)}</td></tr>}
                    <tr><td><b>Profit</b></td><td><b>{taka(profit)}</b></td></tr>
                  </tbody>
                </table>
                <p className="ir-fine">
                  Revenue counts delivered orders; {taka(f.toCollect)} more comes in as the rest are delivered. Delivery charges aren't counted — the courier keeps them.
                  {f.returnedPieces > 0 && ` ${f.returnedPieces} piece${f.returnedPieces === 1 ? '' : 's'} came back (returned parcels).`}
                </p>
              </section>

              <div className="ir-cols">
                <section className="ir-block">
                  <div className="ir-label">BY PRODUCT</div>
                  {products_.length === 0 ? <p className="ir-empty">No sales in these dates.</p> : (
                    <table className="ir-table">
                      <thead><tr><th>Product</th><th>Pieces</th><th>Sales</th></tr></thead>
                      <tbody>
                        {products_.map(([name, e]) => <tr key={name}><td>{name}</td><td>{e.pieces}</td><td>{taka(e.value)}</td></tr>)}
                      </tbody>
                    </table>
                  )}
                </section>
                <section className="ir-block ir-long">
                  <div className="ir-label">AD SPEND BY DATE</div>
                  {ads.length === 0 ? <p className="ir-empty">None.</p> : (
                    <table className="ir-table">
                      <tbody>
                        {ads.map((c) => <tr key={c.id}><td>{day(c.spent_on)}{c.label ? ` · ${c.label}` : ''}</td><td>{taka(c.amount)}</td></tr>)}
                        <tr><td><b>Total</b></td><td><b>{taka(adTotal)}</b></td></tr>
                      </tbody>
                    </table>
                  )}
                </section>
              </div>

              <footer className="ir-foot">PAUSE · Dhaka · sales from the shop's own order records, costs as entered</footer>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
