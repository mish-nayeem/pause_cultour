import { useEffect, useRef, useState } from 'react'

// A form that keeps its own draft. Whatever is typed is saved in this
// browser as you go (localStorage, so a closed tab, a dropped connection or
// a reload doesn't lose it); opening the same form again brings it back
// exactly where it stopped. Saving the form for real (or Cancel) clears it.
//
//   const draft = useDraft('product:new', { p, rows }, (v) => { setP(v.p); setRows(v.rows) })
//   <DraftNote draft={draft} />            — "Unsaved draft restored · Discard"
//   …after a successful save: draft.clear()

const PREFIX = 'pause_draft:'

export function readDraft(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function hasDraft(key) {
  return Boolean(readDraft(key))
}

function writeDraft(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value })) } catch { /* full or blocked: not kept */ }
}

export function removeDraft(key) {
  try { localStorage.removeItem(PREFIX + key) } catch { /* nothing to remove */ }
}

export default function useDraft(key, value, apply, { enabled = true } = {}) {
  const json = JSON.stringify(value)
  const latest = useRef(json)
  latest.current = json
  // What's on screen for which form, as of the last render React finished:
  // { key, json, start } — `start` is the form as it opened. Kept apart from
  // `latest` so a form switching to another key (another page, another
  // product) never files its new contents under the old key.
  const shown = useRef(null)
  const stopped = useRef(false)
  const [restoredAt, setRestoredAt] = useState(null)

  // Opening: bring back a draft that differs from the fresh form.
  useEffect(() => {
    stopped.current = false
    setRestoredAt(null)
    if (!enabled) { shown.current = null; return }
    shown.current = { key, json: latest.current, start: latest.current }
    const d = readDraft(key)
    if (d && JSON.stringify(d.value) !== latest.current) {
      apply(d.value)
      setRestoredAt(d.at)
    }
  }, [key, enabled])

  // `tidy`: a form back to how it opened has no draft. Not on the way out —
  // a form closing before a restored draft has drawn would wipe it.
  function flush(tidy = true) {
    const c = shown.current
    if (!c || stopped.current) return
    if (c.json !== c.start) writeDraft(c.key, JSON.parse(c.json))
    else if (tidy) removeDraft(c.key)
  }

  // Typing: kept a moment after each change, and straight away when the
  // form closes or the page goes away.
  useEffect(() => {
    if (!shown.current || shown.current.key !== key) return undefined
    shown.current = { ...shown.current, json }
    const t = setTimeout(flush, 400)
    return () => clearTimeout(t)
  }, [json, key])

  useEffect(() => {
    const onHide = () => flush(false)
    window.addEventListener('pagehide', onHide)
    return () => { window.removeEventListener('pagehide', onHide); flush(false) }
  }, [key, enabled])

  return {
    restoredAt,
    // Saved for real, or thrown away: forget the draft.
    clear() {
      stopped.current = true
      removeDraft(key)
      setRestoredAt(null)
    },
    // Saved for real but the form stays open: what was saved (`value`, as
    // the form now shows it) is the new starting point, nothing left to keep.
    saved(value) {
      const now = value === undefined ? latest.current : JSON.stringify(value)
      if (shown.current) shown.current = { ...shown.current, json: now, start: now }
      removeDraft(key)
      setRestoredAt(null)
    },
    // Back to the form as it opened.
    discard() {
      removeDraft(key)
      setRestoredAt(null)
      if (shown.current) apply(JSON.parse(shown.current.start))
    },
  }
}
