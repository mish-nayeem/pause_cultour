import { useEffect, useState } from 'react'
import useDraft from '../lib/useDraft.js'
import DraftNote from './DraftNote.jsx'
import { fetchSetting, saveSetting, fetchTickerSpeed, DEFAULT_TICKER, DEFAULT_TICKER_SPEED, TICKER_SPEEDS } from '../lib/siteSettings.js'
import './ticker-manager.css'

// Admin → Homepage → Ticker: the lines that scroll under the hero. Good for
// a running sale or a coupon code ("EID SALE 20% OFF", "CODE EID10").
export default function TickerManager() {
  const [lines, setLines] = useState([])
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [speed, setSpeed] = useState(DEFAULT_TICKER_SPEED)
  const [savedSpeed, setSavedSpeed] = useState(DEFAULT_TICKER_SPEED)

  const [speedLoaded, setSpeedLoaded] = useState(false)
  // Unsaved lines and speed stay in this browser until Save.
  const kept = useDraft('ticker', { lines, speed }, (v) => { setLines(v.lines); setSpeed(v.speed) }, { enabled: !loading && speedLoaded })

  useEffect(() => {
    fetchTickerSpeed().then((n) => { setSpeed(n); setSavedSpeed(n); setSpeedLoaded(true) })
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
    const [{ error }, sp] = await Promise.all([
      saveSetting('ticker', clean),
      speed !== savedSpeed ? saveSetting('ticker_speed', speed) : { error: null },
    ])
    setBusy(false)
    if (!sp.error) setSavedSpeed(speed)
    if (error) {
      setNote("Couldn't save — has supabase-migration-site-settings.sql been run?")
      return
    }
    const shown = clean.length ? clean : DEFAULT_TICKER
    setLines(shown)
    setSaved(shown)
    kept.saved({ lines: shown, speed })
    setNote(clean.length ? 'Saved — live on the homepage now.' : 'Empty, so the homepage shows the default lines.')
  }

  const dirty = JSON.stringify(lines) !== JSON.stringify(saved) || speed !== savedSpeed

  return (
    <section className="panel tk-panel">
      <div className="panel-label mono">TICKER</div>
      <DraftNote draft={kept} />
      <p className="tk-help">
        The strip that scrolls under the homepage photos. Use it for a sale or a coupon code —
        e.g. <b>EID SALE 20% OFF</b> or <b>USE CODE EID10</b>. Shown in capitals. Slide
        SPEED to make it run slower or faster.
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

          {/* 1 slow … 10 fast; the strip below runs at the chosen pace. */}
          <div className="tk-speed">
            <span className="tk-speed-label mono">SPEED</span>
            <span className="tk-speed-end mono">Slow</span>
            <input
              type="range"
              min="1"
              max={TICKER_SPEEDS.length}
              step="1"
              value={speed}
              onChange={(e) => { setSpeed(Number(e.target.value)); setNote('') }}
              aria-label="Ticker speed"
            />
            <span className="tk-speed-end mono">Fast</span>
            <span className="tk-speed-val mono">{speed}/{TICKER_SPEEDS.length}</span>
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
            <div className="tk-preview-run" key={speed} style={{ animationDuration: `${TICKER_SPEEDS[speed - 1] / Math.max(2, Math.ceil(8 / Math.max(1, lines.filter((l) => l.trim()).length)))}s` }}>
              {[0, 1].map((half) => (
                <div className="tk-preview-half" key={half}>
                  {lines.filter((l) => l.trim()).map((l, i) => <span key={i}>{l.trim().toUpperCase()}</span>)}
                </div>
              ))}
            </div>
          </div>

          {note && <div className="tk-note mono">{note}</div>}
        </>
      )}
    </section>
  )
}
