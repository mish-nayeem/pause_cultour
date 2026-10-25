import { supabase } from './supabaseClient.js'
import { getVisitAttribution } from './attribution.js'

// sessionStorage, not localStorage — a "session" for traffic purposes is
// meant to reset when the tab closes, the way it does in any analytics tool,
// unlike the abandoned-cart id which deliberately persists.
const KEY = 'pause_visit_session'

function getSessionId() {
  try {
    let id = sessionStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

// Phone, tablet or computer, by the screen and how it's touched — enough to
// tell where people shop from without a user-agent parser.
function deviceKind() {
  try {
    const touch = window.matchMedia('(pointer: coarse)').matches
    const w = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight)
    if (touch && w < 600) return 'mobile'
    if (touch) return 'tablet'
    return 'desktop'
  } catch {
    return null
  }
}

export async function trackPageView(path) {
  // The admin's own browsing while managing the store isn't a customer
  // visit — counting it would inflate traffic and wreck the conversion rate.
  if (path.startsWith('/admin')) return

  const row = {
    session_id: getSessionId(),
    path,
    referrer: document.referrer || null,
    device: deviceKind(),
  }
  // A visit that came in through a tracked link keeps its source on every
  // page view (supabase-migration-utm-visits.sql adds the columns).
  const utm = getVisitAttribution()
  const withUtm = utm.utm_source
    ? { ...row, utm_source: utm.utm_source, utm_medium: utm.utm_medium || null, utm_campaign: utm.utm_campaign || null }
    : row

  try {
    const { error } = await supabase.from('page_views').insert(withUtm)
    // Before that migration the columns aren't there — log the visit anyway.
    if (error && withUtm !== row && /utm_/.test(error.message || '')) {
      await supabase.from('page_views').insert(row)
    }
  } catch (err) {
    console.warn('[Analytics] trackPageView failed:', err.message)
  }
}
