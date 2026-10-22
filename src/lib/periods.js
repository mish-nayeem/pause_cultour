// Date ranges for the Overview: the presets, the same-length period just
// before (for "vs before"), and the buckets a chart is drawn in.

export const DAY = 86400e3

export function midnight(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function toInput(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

// { start, end, prevStart, prevEnd } in ms; end is exclusive.
export function rangeFor(key, { from, to, firstOrderAt } = {}) {
  const now = new Date()
  const tomorrow = midnight(now).getTime() + DAY
  let start
  let end = tomorrow
  if (key === 'today') start = midnight(now).getTime()
  else if (key === '7d') start = tomorrow - 7 * DAY
  else if (key === '30d') start = tomorrow - 30 * DAY
  else if (key === '90d') start = tomorrow - 90 * DAY
  else if (key === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  else if (key === 'last-month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
    end = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  } else if (key === 'all') start = midnight(firstOrderAt || now).getTime()
  else {
    start = midnight(from ? new Date(from + 'T00:00:00') : now).getTime()
    end = midnight(to ? new Date(to + 'T00:00:00') : now).getTime() + DAY
  }
  if (end <= start) end = start + DAY
  const len = end - start
  let prevStart = start - len
  let prevEnd = start
  if (key === 'month' || key === 'last-month') {
    const s = new Date(start)
    prevStart = new Date(s.getFullYear(), s.getMonth() - 1, 1).getTime()
    prevEnd = start
  }
  return { start, end, prevStart, prevEnd }
}

// Day buckets up to ~2 months, weeks up to ~8 months, then months.
export function bucketsFor(start, end) {
  const days = (end - start) / DAY
  const unit = days <= 62 ? 'day' : days <= 240 ? 'week' : 'month'
  const out = []
  let t = start
  while (t < end) {
    let next
    if (unit === 'day') next = t + DAY
    else if (unit === 'week') next = t + 7 * DAY
    else {
      const d = new Date(t)
      next = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    }
    out.push({ start: t, end: Math.min(next, end) })
    t = next
  }
  return { unit, buckets: out }
}

export function bucketLabel(ms, unit, long = false) {
  const d = new Date(ms)
  if (unit === 'month') return d.toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(long ? { weekday: unit === 'day' ? 'short' : undefined } : {}) })
}
