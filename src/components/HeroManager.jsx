import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { imgUrl, uploadImage } from '../lib/images.js'
import {
  fetchAllHeroSlides,
  createHeroSlide,
  updateHeroSlide,
  deleteHeroSlide,
  reorderHeroSlides,
  slidesFor,
} from '../lib/hero.js'
import { fetchHeroExtras, saveSetting, DEFAULT_HERO_BUTTON, fetchTicker } from '../lib/siteSettings.js'
import { useCountdown } from './DropCountdown.jsx'
import InfoTip from './InfoTip.jsx'
import FocusPicker from './FocusPicker.jsx'
import { IconX } from './Icons.jsx'
import './hero-manager.css'

const DEVICES = [
  ['desktop', 'PC / laptop / tablet', 'Wide photo, about 2400 × 1350 px (16:9).'],
  ['mobile', 'Phones', 'Tall photo, about 1080 × 1920 px (9:16).'],
]

// Admin → Homepage. Everything the homepage shows, in boxes: the hero photos
// (PC and phone apart, each in its real shape), the button on the hero, an
// optional drop countdown, the ticker — and a live preview of all of it on
// a phone and a laptop.
export default function HeroManager({ drops = [], ticker: TickerBox }) {
  const [slides, setSlides] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState(null)

  const [button, setButton] = useState(DEFAULT_HERO_BUTTON)
  const [countdown, setCountdown] = useState({ label: 'NEXT DROP', at: '' })
  const [tickerLines, setTickerLines] = useState([])
  const [saved, setSaved] = useState({ button: '', countdown: '' })
  const [note, setNote] = useState({})

  async function load() {
    setLoading(true)
    const { slides, error } = await fetchAllHeroSlides()
    if (error) setError("Couldn't load hero slides. Did you run the hero SQL?")
    setSlides(slides)
    setLoading(false)
  }

  useEffect(() => {
    load()
    fetchHeroExtras().then(({ button, countdown }) => {
      setButton(button)
      const cd = countdown ? { label: countdown.label || 'NEXT DROP', at: toLocal(countdown.at) } : { label: 'NEXT DROP', at: '' }
      setCountdown(cd)
      setSaved({ button: JSON.stringify(button), countdown: JSON.stringify(cd) })
    })
    fetchTicker().then(setTickerLines)
  }, [])

  async function upload(file, device) {
    setBusy(true)
    setError('')
    try {
      const url = await uploadImage(file, supabase, 'hero')
      const label = (file.name || 'Slide').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toUpperCase().slice(0, 40)
      const { error: createError } = await createHeroSlide({
        label,
        imageUrl: url,
        sortOrder: slides.length,
        device,
      })
      if (createError) throw new Error('Could not save the slide')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function patch(slide, fields) {
    setSlides((prev) => prev.map((s) => (s.id === slide.id ? { ...s, ...fields } : s)))
    setBusy(true)
    await updateHeroSlide(slide.id, fields)
    await load()
    setBusy(false)
  }

  // Up or down among the slides of the same screen; the saved order is the
  // one list, so the swap is with that neighbour in it.
  async function move(group, index, dir) {
    const a = group[index]
    const b = group[index + dir]
    if (!a || !b) return
    const next = [...slides]
    const ia = next.findIndex((s) => s.id === a.id)
    const ib = next.findIndex((s) => s.id === b.id)
    ;[next[ia], next[ib]] = [next[ib], next[ia]]
    setSlides(next)
    setBusy(true)
    await reorderHeroSlides(next)
    await load()
    setBusy(false)
  }

  async function remove(id) {
    setBusy(true)
    await deleteHeroSlide(id)
    setConfirmId(null)
    await load()
    setBusy(false)
  }

  async function saveButton() {
    const clean = { label: (button.label || '').trim().toUpperCase() || DEFAULT_HERO_BUTTON.label, link: (button.link || '').trim() || '/shop' }
    const { error } = await saveSetting('hero_button', clean)
    setButton(clean)
    setNote((n) => ({ ...n, button: error ? "Couldn't save — try again." : 'Saved — live on the homepage.' }))
    if (!error) setSaved((s) => ({ ...s, button: JSON.stringify(clean) }))
  }

  async function saveCountdown(clear = false) {
    const cd = clear ? { label: countdown.label, at: '' } : countdown
    const value = cd.at ? { label: (cd.label || 'NEXT DROP').trim().toUpperCase(), at: new Date(cd.at).toISOString() } : {}
    const { error } = await saveSetting('hero_countdown', value)
    if (clear) setCountdown(cd)
    setNote((n) => ({ ...n, countdown: error ? "Couldn't save — try again." : cd.at ? 'Saved — counting down on the homepage.' : 'Countdown off.' }))
    if (!error) setSaved((s) => ({ ...s, countdown: JSON.stringify(cd) }))
  }

  const groups = useMemo(
    () => ({
      desktop: slides.filter((s) => !s.device || s.device === 'all' || s.device === 'desktop'),
      mobile: slides.filter((s) => !s.device || s.device === 'all' || s.device === 'mobile'),
    }),
    [slides]
  )

  const linkChoices = [
    ['/shop', 'Shop · everything'],
    ['/shop?c=NEW', 'Shop · new arrivals'],
    ...drops.map((d) => [`/lookbook/${encodeURIComponent(d)}`, `Lookbook · ${d}`]),
  ]

  return (
    <div className="hm">
      {error && <div className="err-banner mono">{error}</div>}

      {/* ---- Preview ---- */}
      <Box
        title="PREVIEW"
        tip="How the top of the homepage looks right now, with the photos rotating as they do on the site. It follows your changes as you make them — the button and countdown show here before you save, so check, then save."
        wide
      >
        <Preview slides={slides} button={button} countdown={countdown} ticker={tickerLines} />
      </Box>

      {/* ---- Hero photos, one box per kind of screen ---- */}
      {DEVICES.map(([device, title, size]) => {
        const list = groups[device]
        const own = list.filter((s) => s.device === device).length
        return (
          <Box
            key={device}
            title={`HERO PHOTOS · ${title.toUpperCase()}`}
            wide
            tip={
              <>
                <p>The full-screen photos at the top of the homepage. They rotate every 5 seconds, in this order.</p>
                <p><b>Size:</b> {size} A photo of another shape is cropped to fill the screen — pick which part stays in frame under each photo.</p>
                <p>{device === 'mobile' ? 'If no photo is set for phones, the PC photos are used there too.' : 'If no photo is set for PCs, the phone photos are used there too.'} A photo set to Both shows on every screen.</p>
              </>
            }
          >
            {own === 0 && list.length > 0 && (
              <div className="hm-hint mono">None of its own yet — showing the {device === 'mobile' ? 'PC' : 'phone'} photos marked Both.</div>
            )}
            <div className={`hm-grid ${device}`}>
              {list.map((s, i) => (
                <SlideCard
                  key={s.id}
                  s={s}
                  device={device}
                  first={i === 0}
                  last={i === list.length - 1}
                  busy={busy}
                  confirm={confirmId === s.id}
                  onMove={(dir) => move(list, i, dir)}
                  onPatch={(f) => patch(s, f)}
                  onAskDelete={() => setConfirmId(s.id)}
                  onCancelDelete={() => setConfirmId(null)}
                  onDelete={() => remove(s.id)}
                />
              ))}
              <label className={`hm-add-card mono ${device} ${busy ? 'busy' : ''}`}>
                <span>{busy ? 'Working…' : `+ Add a photo for ${device === 'mobile' ? 'phones' : 'PC'}`}</span>
                <em>{size}</em>
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) upload(f, device)
                  }}
                />
              </label>
            </div>
            {!loading && list.length === 0 && <div className="empty mono">No photos yet — the homepage shows a plain background.</div>}
          </Box>
        )
      })}

      {/* ---- Button ---- */}
      <Box title="HERO BUTTON" tip="The button in the middle of the hero. Point it at a new drop while it's fresh — e.g. SHOP CITYBOY → the CITYBOY lookbook — then back to VIEW SHOP.">
        <label className="pf-field">
          <span className="hm-flabel mono">TEXT</span>
          <input value={button.label} maxLength={28} onChange={(e) => { setButton({ ...button, label: e.target.value }); setNote({}) }} placeholder="VIEW SHOP" />
        </label>
        <label className="pf-field">
          <span className="hm-flabel mono">GOES TO</span>
          <select
            value={linkChoices.some(([v]) => v === button.link) ? button.link : 'custom'}
            onChange={(e) => { if (e.target.value !== 'custom') setButton({ ...button, link: e.target.value }); setNote({}) }}
          >
            {linkChoices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <option value="custom">Another page or link…</option>
          </select>
        </label>
        {!linkChoices.some(([v]) => v === button.link) && (
          <label className="pf-field">
            <span className="hm-flabel mono">LINK<InfoTip>A page on the site starting with /, e.g. /product/pc0006791 — or a full https:// link, which opens in a new tab.</InfoTip></span>
            <input value={button.link} onChange={(e) => { setButton({ ...button, link: e.target.value }); setNote({}) }} placeholder="/shop" />
          </label>
        )}
        <div className="hm-actions">
          <button type="button" className="courier-btn mono" onClick={saveButton} disabled={JSON.stringify(button) === saved.button}>Save button</button>
          {note.button && <span className="hm-note mono">{note.button}</span>}
        </div>
      </Box>

      {/* ---- Countdown ---- */}
      <Box title="DROP COUNTDOWN" tip="A countdown over the hero button — NEXT DROP IN 2D 04:12:09 — to build up a launch. It disappears by itself the moment the time passes. Pair it with a product's Goes live time so the drop appears as the clock hits zero.">
        <label className="pf-field">
          <span className="hm-flabel mono">TEXT ABOVE THE CLOCK</span>
          <input value={countdown.label} maxLength={32} onChange={(e) => { setCountdown({ ...countdown, label: e.target.value }); setNote({}) }} placeholder="NEXT DROP · CITYBOY" />
        </label>
        <label className="pf-field">
          <span className="hm-flabel mono">COUNTS DOWN TO</span>
          <input type="datetime-local" value={countdown.at} onChange={(e) => { setCountdown({ ...countdown, at: e.target.value }); setNote({}) }} />
        </label>
        <div className="hm-actions">
          <button type="button" className="courier-btn mono" onClick={() => saveCountdown(false)} disabled={!countdown.at || JSON.stringify(countdown) === saved.countdown}>Save countdown</button>
          {countdown.at && <button type="button" className="courier-btn ghost mono" onClick={() => saveCountdown(true)}>Turn off</button>}
          {note.countdown && <span className="hm-note mono">{note.countdown}</span>}
        </div>
      </Box>

      {/* ---- Ticker ---- */}
      <div className="hm-ticker">{TickerBox}</div>
    </div>
  )
}

function toLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function Box({ title, tip, wide = false, children }) {
  return (
    <section className={`hm-box ${wide ? 'wide' : ''}`}>
      <div className="hm-box-head">
        <span className="hm-box-title mono">{title}</span>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      {children}
    </section>
  )
}

// One hero photo, shown in the shape of the screen it's for and cropped the
// way the site will crop it, with its settings under it.
function SlideCard({ s, device, first, last, busy, confirm, onMove, onPatch, onAskDelete, onCancelDelete, onDelete }) {
  return (
    <div className={`hm-card ${s.active ? '' : 'off'}`}>
      <div className={`hm-shot ${device}`}>
        <img src={imgUrl(s.image_url, { w: device === 'mobile' ? 360 : 640 })} alt="" style={{ objectPosition: s.focus || 'center' }} />
        {!s.active && <span className="hm-hidden mono">HIDDEN</span>}
        <span className="hm-pos mono">{s.device === 'all' || !s.device ? 'BOTH' : device === 'mobile' ? 'PHONE' : 'PC'}</span>
      </div>

      <input
        className="hm-name mono"
        defaultValue={s.label}
        aria-label="Your name for this photo"
        title="Your own name for this photo — not shown on the site"
        onBlur={(e) => {
          const v = e.target.value.trim().toUpperCase()
          if (v && v !== s.label) onPatch({ label: v })
        }}
      />

      <FocusPicker value={s.focus} disabled={busy} onChange={(focus) => onPatch({ focus })} />

      <div className="hm-card-row mono">
        <select value={s.device || 'all'} disabled={busy} onChange={(e) => onPatch({ device: e.target.value })} aria-label="Shows on">
          <option value="desktop">PC only</option>
          <option value="mobile">Phones only</option>
          <option value="all">Both</option>
        </select>
        <span className="hm-move">
          <button type="button" onClick={() => onMove(-1)} disabled={first || busy} aria-label="Earlier">←</button>
          <button type="button" onClick={() => onMove(1)} disabled={last || busy} aria-label="Later">→</button>
        </span>
      </div>

      <div className="hm-card-row mono">
        <button type="button" className={`hm-vis ${s.active ? 'on' : ''}`} onClick={() => onPatch({ active: !s.active })} disabled={busy}>
          {s.active ? 'Showing' : 'Hidden'}
        </button>
        {confirm ? (
          <span className="hm-confirm">
            <button type="button" className="hm-danger" onClick={onDelete}>Delete</button>
            <button type="button" className="hm-ghost" onClick={onCancelDelete}>No</button>
          </span>
        ) : (
          <button type="button" className="hm-x" onClick={onAskDelete} aria-label="Delete photo"><IconX width="13" height="13" /></button>
        )}
      </div>
    </div>
  )
}

// The top of the homepage on a phone and on a laptop, rotating like the site.
function Preview({ slides, button, countdown, ticker }) {
  const live = slides.filter((s) => s.active)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3000)
    return () => clearInterval(id)
  }, [])
  const left = useCountdown(countdown.at || '')

  function frame(isPhone) {
    const list = slidesFor(live, isPhone)
    const cur = list.length ? list[tick % list.length] : null
    return (
      <div className={`hm-frame ${isPhone ? 'phone' : 'pc'}`}>
        <div className="hm-frame-screen">
          {cur && <img src={imgUrl(cur.image_url, { w: isPhone ? 360 : 720 })} alt="" style={{ objectPosition: cur.focus || 'center' }} />}
          <div className="hm-frame-shade" />
          <div className="hm-frame-center mono">
            {left && (
              <span className="hm-frame-count">
                <small>{(countdown.label || 'NEXT DROP').toUpperCase()}</small>
                {left}
              </span>
            )}
            <span className="hm-frame-btn">{(button.label || 'VIEW SHOP').toUpperCase()}</span>
          </div>
          {list.length > 1 && (
            <div className="hm-frame-dots">{list.map((s, i) => <i key={s.id} className={i === tick % list.length ? 'on' : ''} />)}</div>
          )}
        </div>
        <div className="hm-frame-ticker mono">{ticker.join('   ·   ')}</div>
        <div className="hm-frame-name mono">{isPhone ? 'PHONE' : 'PC / LAPTOP'}</div>
      </div>
    )
  }

  return (
    <div className="hm-preview">
      {frame(false)}
      {frame(true)}
    </div>
  )
}
