import { useEffect, useState } from 'react'
import { fetchSetting, saveSetting, DEFAULT_TICKER } from '../lib/siteSettings.js'
import './ticker-manager.css'

// Admin → Homepage → Ticker: the lines that scroll under the hero. Good for
// a running sale or a coupon code ("EID SALE 20% OFF", "CODE EID10").
export default function TickerManager() {
  const [lines, setLines] = useState([])
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    fetchSetting('ticker').then(({ value, error }) => {
      const list = Array.isArray(value) && value.length ? value.map(String) : DEFAULT_TICKER
      setLines(list)
      setSaved(list)
      setLoading(false)
      if (error) setNote("Couldn't load — has supabase-migration-site-settings.sql been run?")
    })
  }, [])

  function edit(i, text) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? text : l)))
    setNote('')
  }

  function move(i, dir) {
    setLines((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setNote('')
  }

  function remove(i) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
    setNote('')
  }

  async function save(list) {
    const clean = list.map((l) => l.trim().toUpperCase()).filter(Boolean)
    setBusy(true)
    const { error } = await saveSetting('ticker', clean)
    setBusy(false)
    if (error) {
      setNote("Couldn't save — has supabase-migration-site-settings.sql been run?")
      return
    }
    const shown = clean.length ? clean : DEFAULT_TICKER
    setLines(shown)
    setSaved(shown)
    setNote(clean.length ? 'Saved — live on the homepage now.' : 'Empty, so the homepage shows the default lines.')
  }

  const dirty = JSON.stringify(lines) !== JSON.stringify(saved)

  return (
    <section className="panel tk-panel">
      <div className="panel-label mono">TICKER</div>
      <p className="tk-help">
        The strip that scrolls under the homepage photos. Use it for a sale or a coupon code —
        e.g. <b>EID SALE 20% OFF</b> or <b>USE CODE EID10</b>. Shown in capitals.
      </p>

      {loading ? (
        <div className="empty mono">Loading…</div>
      ) : (
        <>
          <div className="tk-list">
            {lines.map((line, i) => (
              <div className="tk-row" key={i}>
                <span className="tk-num mono">{i + 1}</span>
                <input
                  value={line}
                  maxLength={60}
                  onChange={(e) => edit(i, e.target.value)}
                  placeholder="Type a line…"
                />
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === lines.length - 1} aria-label="Move down">↓</button>
                <button type="button" className="tk-del" onClick={() => remove(i)} aria-label="Remove line">×</button>
              </div>
            ))}
          </div>

          <div className="tk-actions">
            <button type="button" className="tk-add mono" onClick={() => setLines((p) => [...p, ''])} disabled={lines.length >= 12}>
              + Add line
            </button>
            <button type="button" className="tk-reset mono" onClick={() => save([])} disabled={busy}>
              Back to default
            </button>
            <button type="button" className="mof-submit mono tk-save" onClick={() => save(lines)} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save ticker'}
            </button>
          </div>

          {/* What the strip will read, in order. */}
          <div className="tk-preview mono" aria-hidden="true">
            {lines.filter((l) => l.trim()).map((l, i) => <span key={i}>{l.trim().toUpperCase()}</span>)}
          </div>

          {note && <div className="tk-note mono">{note}</div>}
        </>
      )}
    </section>
  )
}
