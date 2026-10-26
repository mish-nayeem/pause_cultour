import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { imgUrl } from '../lib/images.js'
import { fetchPromos, promoCards, colorOf } from '../lib/promos.js'
import { useCountdown, FlipText } from './DropCountdown.jsx'
import './promo-banners.css'

function Countdown({ at, label }) {
  const left = useCountdown(at)
  if (!left) return null
  return <span className="pb-count mono">{label} <FlipText text={left} /></span>
}

function CopyCode({ code }) {
  const [done, setDone] = useState(false)
  async function copy(e) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Older browsers: a hidden field and the old copy command.
      const t = document.createElement('textarea')
      t.value = code
      document.body.appendChild(t)
      t.select()
      document.execCommand('copy')
      t.remove()
    }
    setDone(true)
    setTimeout(() => setDone(false), 1800)
  }
  return (
    <button type="button" className="pb-copy mono" onClick={copy}>
      {done ? 'COPIED ✓' : 'COPY CODE'}
    </button>
  )
}

export function PromoCard({ card }) {
  const c = card.kind === 'coupon' ? colorOf(card.color) : null
  const body = (
    <>
      {card.image && <img className="pb-thumb" src={imgUrl(card.image, { w: 240, h: 240 })} alt="" loading="lazy" />}
      <div className="pb-text">
        <span className="pb-kind mono">{card.kind === 'soon' ? 'NEW DROP' : card.kind === 'sale' ? 'SALE' : 'COUPON'}</span>
        <span className="pb-title">{card.title}</span>
        <span className="pb-sub mono">{card.sub}</span>
        {card.kind === 'soon' && <Countdown at={card.endsAt} label="DROPS IN" />}
        {card.kind === 'sale' && <Countdown at={card.endsAt} label="ENDS IN" />}
      </div>
      {card.kind === 'coupon' ? <CopyCode code={card.code} /> : <span className="pb-go mono">{card.kind === 'soon' ? 'SEE DROP →' : 'SHOP →'}</span>}
    </>
  )
  const cls = `pb-card pb-${card.kind}`
  const style = c ? { background: c.bg, color: c.ink } : undefined
  return card.link
    ? <Link to={card.link} className={cls} style={style}>{body}</Link>
    : <div className={cls} style={style}>{body}</div>
}

// The banners for one place — Website → Banners says which kinds show where.
// `data` can be passed in (the admin preview); otherwise it's fetched.
export default function PromoBanners({ place, data: given, className = '' }) {
  const [data, setData] = useState(given || null)
  useEffect(() => {
    if (given) return setData(given)
    let off = false
    fetchPromos().then((d) => { if (!off) setData(d) }).catch(() => {})
    return () => { off = true }
  }, [given])

  const cards = promoCards(data, place)
  if (!cards.length) return null
  return (
    <section className={`pb-row ${className}`} aria-label="Offers">
      {cards.map((card) => <PromoCard key={card.key} card={card} />)}
    </section>
  )
}

// A drop's own banner photo, on top of its page in the shop.
export function DropHero({ banner }) {
  if (!banner?.image) return null
  return (
    <div className="pb-drop-hero">
      <img src={imgUrl(banner.image, { w: 1800 })} alt={banner.name || ''} />
      {banner.soon !== false && banner.launch_at && <div className="pb-drop-count"><Countdown at={banner.launch_at} label="DROPS IN" /></div>}
    </div>
  )
}
