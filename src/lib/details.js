// Product details are a two-column list — "Fabric | 100% cotton". The database
// column is still the plain `details` text it always was, so nothing needs
// migrating: each row is one line, "Label: value". A line with no label is an
// ordinary bullet, which is exactly what every product saved before this was.
//
// The storefront only shows rows that have both a label and a value. A row
// with an empty value isn't written at all; a value with no label is kept in
// the text but stays hidden from customers.

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

// Labels typed into the form are remembered in this browser too, so one that
// was added but left blank on the last product still comes back on the next.
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
    const merged = mergeLabels(rememberedLabels(), labels)
    localStorage.setItem(LABELS_KEY, JSON.stringify(merged))
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
