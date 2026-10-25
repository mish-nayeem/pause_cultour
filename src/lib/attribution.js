// Captures the ?utm_* params off the link a customer clicked to land here,
// straight into localStorage — so it survives from that reel/story click all
// the way through browsing to checkout, however many pages later that is.
//
// Call captureAttribution() once, at app startup: a client-side route change
// never touches the address bar's query string, so there is nothing new to
// read on later navigations within the same visit.
//
// A click counts for ATTRIBUTION_DAYS: an order placed later than that,
// with no newer link clicked, counts as Direct. The last link clicked wins.

const KEY = 'pause_attribution'
// This visit's own link, if it arrived through one — page views carry it,
// so a source's visits can be counted, not just its orders.
const VISIT_KEY = 'pause_visit_utm'
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
export const ATTRIBUTION_DAYS = 30

export function captureAttribution() {
  const params = new URLSearchParams(window.location.search)
  const hasUtm = FIELDS.some((f) => params.has(f))

  // No tracked link on this load — leave whatever was captured earlier in
  // place, so browsing the site afterwards doesn't erase where they came from.
  if (!hasUtm) return

  const attribution = { captured_at: Date.now() }
  FIELDS.forEach((f) => {
    const v = (params.get(f) || '').trim()
    attribution[f] = v ? v.toLowerCase() : null
  })

  try {
    localStorage.setItem(KEY, JSON.stringify(attribution))
  } catch {
    // Storage can be blocked (private mode, full quota) — the order still
    // goes through, just without attribution attached.
  }
  try {
    sessionStorage.setItem(VISIT_KEY, JSON.stringify(attribution))
  } catch { /* the visit just isn't counted under its source */ }
}

export function getAttribution() {
  try {
    const raw = localStorage.getItem(KEY)
    const a = raw ? JSON.parse(raw) : {}
    // Too old to credit (a link from before the 30 days) — or saved before
    // the date was kept, which is older still.
    if (!a.captured_at || Date.now() - a.captured_at > ATTRIBUTION_DAYS * 86400e3) return {}
    return a
  } catch {
    return {}
  }
}

// The link this visit arrived through, for page views; {} for a visit that
// didn't come through a tracked link.
export function getVisitAttribution() {
  try {
    const raw = sessionStorage.getItem(VISIT_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
