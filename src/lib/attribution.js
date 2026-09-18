// Captures the ?utm_* params off the link a customer clicked to land here,
// straight into localStorage — so it survives from that reel/story click all
// the way through browsing to checkout, however many pages later that is.
//
// Call captureAttribution() once, at app startup: a client-side route change
// never touches the address bar's query string, so there is nothing new to
// read on later navigations within the same visit.

const KEY = 'pause_attribution'
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

export function captureAttribution() {
  const params = new URLSearchParams(window.location.search)
  const hasUtm = FIELDS.some((f) => params.has(f))

  // No tracked link on this load — leave whatever was captured earlier in
  // place, so browsing the site afterwards doesn't erase where they came from.
  if (!hasUtm) return

  const attribution = {}
  FIELDS.forEach((f) => {
    attribution[f] = params.get(f) || null
  })

  try {
    localStorage.setItem(KEY, JSON.stringify(attribution))
  } catch {
    // Storage can be blocked (private mode, full quota) — the order still
    // goes through, just without attribution attached.
  }
}

export function getAttribution() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
