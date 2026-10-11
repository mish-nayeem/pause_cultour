// Product details are a two-column list — "Fabric | 100% cotton". The database
// column is still the plain `details` text it always was, so nothing needs
// migrating: each row is one line, "Label: value". A line with no label is an
// ordinary bullet, which is exactly what every product saved before this was.
//
// Customers see only the values ("100% cotton"), one per line — the labels
// are the admin's own way of keeping the boxes in order. A row with an empty
// value isn't written at all.

const MAX_LABEL = 30
const LABELS_KEY = 'pause_detail_labels'

export function parseDetails(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':')
      if (i > 0 && i <= MAX_LABEL) {
        const label = line.slice(0, i).trim()
        const value = line.slice(i + 1).trim()
        if (label && value) return { label, value }
        // "Care:" with nothing after it is an empty box, not a detail.
        if (label && !value) return { label, value: '' }
      }
      return { label: '', value: line }
    })
}

export function serializeDetails(rows) {
  return rows
    .map((r) => ({
      // A colon in the label would be read back as the end of it.
      label: r.label.replace(/:/g, '').trim(),
      value: r.value.trim(),
    }))
    .filter((r) => r.value)
    .map((r) => (r.label ? `${r.label}: ${r.value}` : r.value))
    .join('\n')
}

// Every label already used on a saved product, in the order first seen — these
// are what a new product's form starts with.
export function collectLabels(products) {
  const seen = new Map()

  products.forEach((p) => {
    parseDetails(p.details).forEach((r) => {
      if (r.label && !seen.has(r.label.toLowerCase())) seen.set(r.label.toLowerCase(), r.label)
    })
  })

  return [...seen.values()]
}

// The boxes the most recently made product had (newest by created_at) —
// what a new product's form starts with when this browser has none saved.
export function lastLabels(products) {
  const newest = [...products]
    .filter((p) => parseDetails(p.details).some((r) => r.label))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0]
  return newest ? parseDetails(newest.details).filter((r) => r.label).map((r) => r.label) : []
}

// The boxes on the last product saved in this browser — every one of them,
// filled or not, so a new product starts with exactly that set (values
// empty). Boxes removed with × don't come back.
export function rememberedLabels() {
  try {
    const saved = JSON.parse(localStorage.getItem(LABELS_KEY) || '[]')
    return Array.isArray(saved) ? saved.filter((l) => typeof l === 'string') : []
  } catch {
    return []
  }
}

export function rememberLabels(labels) {
  try {
    localStorage.setItem(LABELS_KEY, JSON.stringify(mergeLabels(labels)))
  } catch {
    // Storage blocked: the labels on saved products still carry over.
  }
}

export function mergeLabels(...lists) {
  const seen = new Map()
  lists.flat().forEach((l) => {
    const clean = String(l || '').replace(/:/g, '').trim()
    if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean)
  })
  return [...seen.values()]
}
