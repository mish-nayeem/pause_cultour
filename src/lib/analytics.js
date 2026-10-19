import { supabase } from './supabaseClient.js'

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

  try {
    await supabase.from('page_views').insert({
      session_id: getSessionId(),
      path,
      referrer: document.referrer || null,
      device: deviceKind(),
    })
  } catch (err) {
    console.warn('[Analytics] trackPageView failed:', err.message)
  }
}
