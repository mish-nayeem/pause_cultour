// Products this visitor has opened, newest first — shown under the search
// bar. Kept in this browser only.
const KEY = 'pause_recent'
const MAX = 8

export function recentIds() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function rememberViewed(id) {
  try {
    const next = [String(id), ...recentIds().filter((x) => x !== String(id))].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: nothing to remember, nothing breaks.
  }
}
