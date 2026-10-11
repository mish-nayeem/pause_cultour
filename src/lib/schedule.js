// Product launch times (products.publish_at). The admin types a local
// date-time; the database keeps the exact moment.

// ISO timestamp → the "YYYY-MM-DDTHH:mm" a datetime-local input wants, in the
// browser's own time zone (Dhaka for the admin).
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null
}

export function isScheduled(row, now = Date.now()) {
  return Boolean(row?.publish_at) && new Date(row.publish_at).getTime() > now
}

// "12 Oct, 10:00 pm"
export function launchLabel(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}
