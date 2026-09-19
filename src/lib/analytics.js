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

export async function trackPageView(path) {
  // The admin's own browsing while managing the store isn't a customer
  // visit — counting it would inflate traffic and wreck the conversion rate.
  if (path.startsWith('/admin')) return

  try {
    await supabase.from('page_views').insert({
      session_id: getSessionId(),
      path,
      referrer: document.referrer || null,
    })
  } catch (err) {
    console.warn('[Analytics] trackPageView failed:', err.message)
  }
}
