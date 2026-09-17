import { supabase } from './supabaseClient.js'

// The wishlist is a queue for sold-out sizes: a customer leaves an email and
// gets one mail when that size is back on the shelf.
//
// Customers can insert and nothing else — the table's policies don't let them
// read it, so nobody can pull anyone else's address out of it. That also means
// the page can't ask the database whether someone already signed up, so a
// local note is kept in the browser purely to keep the button honest. Losing
// it costs nothing: the unique index is what actually prevents a duplicate.

const STORAGE_KEY = 'pause_wishlist'

function localKey(productId, size) {
  return `${productId}::${size || ''}`
}

function readLocal() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocal(keys) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // Private windows and blocked storage: the row is saved either way.
  }
}

export function hasJoined(productId, size) {
  return readLocal().includes(localKey(productId, size))
}

// Remembers the email so the next sold-out size doesn't ask for it again.
export function savedEmail() {
  try {
    return localStorage.getItem('pause_wishlist_email') || ''
  } catch {
    return ''
  }
}

function saveEmail(email) {
  try {
    localStorage.setItem('pause_wishlist_email', email)
  } catch {
    // Same as above — not worth failing the signup over.
  }
}

export async function joinWishlist({ product, size, email }) {
  const clean = email.trim().toLowerCase()

  const { error } = await supabase.from('wishlist').insert({
    product_id: product.id,
    product_name: product.name,
    size: size || null,
    email: clean,
  })

  // 23505 is the unique index: this person is already waiting on this size,
  // which is the outcome they wanted anyway.
  if (error && error.code !== '23505') {
    console.error('[Supabase] joinWishlist failed:', error.message)
    return { error }
  }

  saveEmail(clean)

  const keys = readLocal()
  const key = localKey(product.id, size)
  if (!keys.includes(key)) writeLocal([...keys, key])

  return { error: null }
}

// ---------- Admin ----------

export async function fetchWishlist() {
  const { data, error } = await supabase
    .from('wishlist')
    .select('*')
    .is('notified_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[Supabase] fetchWishlist failed:', error.message)
    return { rows: [], error }
  }

  return { rows: data, error: null }
}

// Groups the open requests into one line per product and size — what to make
// more of, busiest first.
export function groupDemand(rows) {
  const groups = new Map()

  rows.forEach((r) => {
    const key = `${r.product_id}::${r.size || ''}`
    const group = groups.get(key) || {
      key,
      productId: r.product_id,
      name: r.product_name,
      size: r.size || '',
      emails: [],
      waitingSince: r.created_at,
    }

    group.emails.push(r.email)
    groups.set(key, group)
  })

  return [...groups.values()].sort(
    (a, b) => b.emails.length - a.emails.length || a.name.localeCompare(b.name)
  )
}
