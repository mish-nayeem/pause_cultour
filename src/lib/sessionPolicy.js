import { supabase } from './supabaseClient.js'

// "Remember me". Supabase keeps a login in localStorage until it's signed out,
// which is what a ticked box means. Unticked, the login should end when the
// browser is closed — and there's no "session cookie" to lean on for that, so
// a heartbeat stands in: while any tab is open it stamps the time, and a page
// that loads to find the stamp long stale knows the browser was closed in
// between and signs out. Other tabs keep it fresh, so opening a second tab
// doesn't log anyone out.

const FLAG = 'pause_session_only'
const BEAT = 'pause_alive'
const BEAT_EVERY_MS = 15000
const STALE_AFTER_MS = 3 * 60 * 1000

function store(fn) {
  try {
    return fn(window.localStorage)
  } catch {
    return undefined
  }
}

// Called at sign-in with the state of the checkbox.
export function setRemember(remember) {
  store((ls) => {
    if (remember) ls.removeItem(FLAG)
    else {
      ls.setItem(FLAG, '1')
      ls.setItem(BEAT, String(Date.now()))
    }
  })
}

export function clearRemember() {
  store((ls) => ls.removeItem(FLAG))
}

// Called once when the app starts.
export function startSessionPolicy() {
  const sessionOnly = () => store((ls) => ls.getItem(FLAG) === '1')

  if (sessionOnly()) {
    const last = store((ls) => Number(ls.getItem(BEAT) || 0)) || 0
    if (Date.now() - last > STALE_AFTER_MS) {
      supabase.auth.signOut()
      clearRemember()
    }
  }

  const beat = () => {
    if (sessionOnly()) store((ls) => ls.setItem(BEAT, String(Date.now())))
  }

  beat()
  setInterval(beat, BEAT_EVERY_MS)
}
