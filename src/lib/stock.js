// Per-size stock, read the same way everywhere.
//
// A product carries its counts as a map on the row: {"S": 4, "M": 0, "L": 2}.
// Leave it empty and the product is untracked — it behaves exactly as the
// catalog did before stock existed, which is what keeps the older products
// working without anyone going back to fill in numbers.
//
// Two things can take a size off the page, and both are honoured here: the
// count reaching zero, and `sizes_out`, which stays as the manual override for
// a size you want hidden even though the pieces are on the shelf.
//
// The helpers accept either shape of product — the storefront's camelCase one
// from products.js or a raw admin row — because the admin panel reads rows
// straight from the table.

export const LOW_STOCK_AT = 3

function sizesOf(product) {
  return Array.isArray(product?.sizes) ? product.sizes : []
}

function manualOut(product) {
  const out = product?.sizesOut ?? product?.sizes_out
  return Array.isArray(out) ? out : []
}

// Normalised counts, or null when this product isn't tracked at all.
export function stockMap(product) {
  const raw = product?.stock

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const map = {}
  for (const [size, value] of Object.entries(raw)) {
    const n = Number(value)
    map[size] = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
  }

  return Object.keys(map).length > 0 ? map : null
}

export function isTracked(product) {
  return stockMap(product) !== null
}

// Pieces left in that size — null when the product keeps no count, which is
// not the same as zero and must not be rendered as one.
export function left(product, size) {
  const map = stockMap(product)
  if (!map) return null
  return map[size] ?? 0
}

export function isSoldOut(product, size) {
  if (manualOut(product).includes(size)) return true

  const remaining = left(product, size)
  return remaining === null ? false : remaining <= 0
}

export function availableSizes(product) {
  return sizesOf(product).filter((s) => !isSoldOut(product, s))
}

// Every size the page should show struck through: the ones that ran out, plus
// any manual entry that isn't in the size list at all.
export function soldOutSizes(product) {
  const listed = sizesOf(product).filter((s) => isSoldOut(product, s))
  const extras = manualOut(product).filter((s) => !sizesOf(product).includes(s))
  return [...listed, ...extras]
}

// True when there is nothing on this product left to buy. A product that
// carries no sizes at all is only sold out if a size was struck off by hand —
// otherwise it has simply never had any to list.
export function isAllSoldOut(product) {
  const sizes = sizesOf(product)
  if (sizes.length > 0) return availableSizes(product).length === 0
  return manualOut(product).length > 0
}

export function totalStock(product) {
  const map = stockMap(product)
  if (!map) return null
  return sizesOf(product).reduce((sum, s) => sum + (map[s] ?? 0), 0)
}

// Sizes worth reordering — out first, then whatever is nearly gone. Manual
// overrides are left out: those are off the page on purpose, not running low.
export function lowSizes(product, threshold = LOW_STOCK_AT) {
  const map = stockMap(product)
  if (!map) return []

  return sizesOf(product)
    .filter((s) => !manualOut(product).includes(s) && (map[s] ?? 0) <= threshold)
    .map((s) => ({ size: s, left: map[s] ?? 0 }))
    .sort((a, b) => a.left - b.left)
}

// The counts as the form should show them: one entry per current size, so a
// size that was just added starts at 0 and a size that was removed drops out.
export function stockForSizes(product, sizes) {
  const map = stockMap(product) || {}
  const out = {}
  sizes.forEach((s) => {
    out[s] = map[s] ?? 0
  })
  return out
}
