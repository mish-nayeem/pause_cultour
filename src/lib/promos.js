import { supabase } from './supabaseClient.js'
import { fetchSetting, saveSetting } from './siteSettings.js'
import { fetchLiveSales } from './sales.js'
import { dropKey } from './lookbook.js'

// The storefront's promo banners — coming drops, running sales and coupon
// boxes — all from site_settings, so no table of their own:
//
//   drop_banners  { [dropKey]: { name, image, launch_at, soon } }
//                 Each collection's banner photo (Products → Collections),
//                 shown on top of its drop page and, small, on any sale or
//                 coupon for that drop. launch_at is copied in when the
//                 collection gets a launch time; soon (default on) =
//                 announce it before.
//   promo_boxes   [{ id, color, code, text, target, drop, product_id, on }]
//                 The five coupon boxes (Website → Banners). Written by hand
//                 because the coupons table is secret from visitors.
//   promo_places  { soon: [...], sale: [...], coupon: [...] }
//                 Where each kind shows: 'home', 'shop', 'cart'.

export const BOX_COLORS = [
  { key: 'sun', label: 'Yellow', bg: '#FFD84D', ink: '#1A1A1A' },
  { key: 'rose', label: 'Pink', bg: '#FF6B9A', ink: '#FFFFFF' },
  { key: 'mint', label: 'Green', bg: '#3DDC97', ink: '#0F2A1E' },
  { key: 'sky', label: 'Blue', bg: '#3F7CFF', ink: '#FFFFFF' },
  { key: 'ink', label: 'Black', bg: '#141414', ink: '#FFFFFF' },
]

export const colorOf = (key) => BOX_COLORS.find((c) => c.key === key) || BOX_COLORS[0]

export const DEFAULT_BOXES = BOX_COLORS.map((c, i) => ({
  id: `box${i + 1}`,
  color: c.key,
  code: '',
  text: '',
  target: 'none', // none | drop | product
  drop: '',
  product_id: '',
  on: true,
}))

export const PLACES = [
  { key: 'home', label: 'Homepage' },
  { key: 'shop', label: 'Shop page' },
  { key: 'cart', label: 'Cart' },
]

export const DEFAULT_PLACES = {
  soon: ['home', 'shop'],
  sale: ['home', 'shop', 'cart'],
  coupon: ['home', 'shop', 'cart'],
}

export async function fetchDropBanners() {
  const { value, error } = await fetchSetting('drop_banners')
  return { banners: value && typeof value === 'object' && !Array.isArray(value) ? value : {}, error }
}

export function dropBannerFor(name, banners) {
  return name ? banners?.[dropKey(name)] || null : null
}

// Saves one collection's entry, merged into what's already there.
export async function saveDropBanner(name, patch) {
  const { banners, error } = await fetchDropBanners()
  if (error) return { error }
  const k = dropKey(name)
  const next = { ...banners, [k]: { ...(banners[k] || {}), name, ...patch } }
  return saveSetting('drop_banners', next)
}

// A renamed collection keeps its banner.
export async function renameDropBanner(from, to) {
  const { banners, error } = await fetchDropBanners()
  if (error || !banners[dropKey(from)]) return { error }
  const next = { ...banners }
  next[dropKey(to)] = { ...next[dropKey(from)], name: to }
  delete next[dropKey(from)]
  return saveSetting('drop_banners', next)
}

export async function fetchBoxes() {
  const { value, error } = await fetchSetting('promo_boxes')
  if (!Array.isArray(value)) return { boxes: DEFAULT_BOXES, error }
  // Always five, in the saved order; a missing one comes back empty.
  const boxes = DEFAULT_BOXES.map((d, i) => ({ ...d, ...(value[i] || {}) }))
  return { boxes, error }
}

export async function fetchPlaces() {
  const { value, error } = await fetchSetting('promo_places')
  const places = { ...DEFAULT_PLACES }
  if (value && typeof value === 'object') for (const k of Object.keys(DEFAULT_PLACES)) if (Array.isArray(value[k])) places[k] = value[k]
  return { places, error }
}

// The few products a banner needs a photo of, without loading the catalog.
async function fetchThumbs(ids) {
  if (!ids.length) return {}
  const { data } = await supabase.from('products').select('id, name, images').in('id', ids)
  return Object.fromEntries((data || []).map((p) => [String(p.id), p]))
}

let cache = null
let cacheAt = 0

// Everything a page needs to draw its banners, in one go (kept a minute).
export async function fetchPromos() {
  if (cache && Date.now() - cacheAt < 60_000) return cache
  const [{ banners }, { boxes }, { places }, sales] = await Promise.all([fetchDropBanners(), fetchBoxes(), fetchPlaces(), fetchLiveSales()])
  const ids = new Set()
  for (const s of sales) for (const id of s.product_ids || []) ids.add(String(id))
  for (const b of boxes) if (b.on && b.code && b.target === 'product' && b.product_id) ids.add(String(b.product_id))
  const thumbs = await fetchThumbs([...ids])
  cache = { banners, boxes, places, sales, thumbs }
  cacheAt = Date.now()
  return cache
}

// Coupon boxes follow the coupons themselves (Marketing → Coupons): a box
// whose code was deleted is emptied, and one whose coupon is switched off
// stops showing — so the shop never shows a code checkout won't take.
export async function pruneCouponBoxes(coupons) {
  const { value } = await fetchSetting('promo_boxes')
  if (!Array.isArray(value)) return
  const all = new Map(coupons.map((c) => [String(c.code).trim().toUpperCase(), c]))
  let changed = false
  const next = value.map((b) => {
    const code = String(b?.code || '').trim().toUpperCase()
    if (!code) return b
    const c = all.get(code)
    if (!c) { changed = true; return { ...b, code: '', text: '', on: false } }
    if (!c.active && b.on) { changed = true; return { ...b, on: false } }
    return b
  })
  if (changed) {
    await saveSetting('promo_boxes', next)
    clearPromoCache()
  }
}

export function clearPromoCache() {
  cache = null
}

// The banner cards for one place, in order: coming drops, sales, coupons.
// Each card: { key, kind, title, sub, endsAt, image, link, code, color }.
export function promoCards(data, place, now = Date.now()) {
  if (!data) return []
  const { banners, boxes, places, sales, thumbs } = data
  const cards = []
  const firstPhoto = (id) => thumbs[String(id)]?.images?.[0] || null

  if (places.soon.includes(place)) {
    for (const b of Object.values(banners)) {
      if (b?.soon === false || !b?.launch_at || new Date(b.launch_at).getTime() <= now) continue
      cards.push({ key: `soon-${b.name}`, kind: 'soon', title: `${b.name} · DROPPING SOON`, sub: 'New drop', endsAt: b.launch_at, image: b.image || null, link: `/shop?d=${encodeURIComponent(b.name)}` })
    }
  }

  if (places.sale.includes(place)) {
    for (const s of sales) {
      if (new Date(s.starts_at).getTime() > now || new Date(s.ends_at).getTime() <= now) continue
      const ids = s.product_ids || []
      let sub = 'On everything'
      let image = null
      let link = '/shop'
      if (s.drop_name) {
        sub = `On the ${s.drop_name} drop`
        image = dropBannerFor(s.drop_name, banners)?.image || null
        link = `/shop?d=${encodeURIComponent(s.drop_name)}`
      } else if (ids.length) {
        sub = ids.length === 1 ? (thumbs[String(ids[0])]?.name || 'On one piece') : `On ${ids.length} pieces`
        image = firstPhoto(ids[0])
        if (ids.length === 1) link = `/product/${ids[0]}`
      }
      cards.push({ key: `sale-${s.id}`, kind: 'sale', title: `${s.name ? s.name.toUpperCase() + ' · ' : ''}${s.percent}% OFF`, sub, endsAt: s.ends_at, image, link })
    }
  }

  if (places.coupon.includes(place)) {
    for (const b of boxes) {
      if (!b.on || !String(b.code || '').trim()) continue
      let image = null
      let link = null
      if (b.target === 'drop' && b.drop) {
        image = dropBannerFor(b.drop, banners)?.image || null
        link = `/shop?d=${encodeURIComponent(b.drop)}`
      } else if (b.target === 'product' && b.product_id) {
        image = firstPhoto(b.product_id)
        link = `/product/${b.product_id}`
      }
      cards.push({ key: `coupon-${b.id}`, kind: 'coupon', title: String(b.code).trim().toUpperCase(), sub: b.text || 'Use this code at checkout', image, link, code: String(b.code).trim().toUpperCase(), color: b.color })
    }
  }
  return cards
}
