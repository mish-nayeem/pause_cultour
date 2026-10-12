import { useRef, useState } from 'react'

// Drag-to-reorder for a list, by a handle on each row. Pointer events, so it
// works with a mouse and with a finger. While dragging, rows move live; on
// release, onDrop gets the ids in their new order (only if it changed).
export default function useDragList(items, onDrop) {
  const [order, setOrder] = useState(null)
  const [dragId, setDragId] = useState(null)
  const rows = useRef(new Map())

  function start(e, id) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const before = items.map((i) => i.id)
    let current = before
    setOrder(before)
    setDragId(id)

    function move(ev) {
      const y = ev.clientY
      const others = current.filter((x) => x !== id)
      let at = 0
      for (const other of others) {
        const el = rows.current.get(other)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (y > r.top + r.height / 2) at++
      }
      const next = [...others]
      next.splice(at, 0, id)
      if (next.join('\u0000') !== current.join('\u0000')) {
        current = next
        setOrder(next)
      }
      // Near the top or bottom edge the page scrolls, so a product can be
      // carried further than one screen.
      if (y < 70) window.scrollBy(0, -14)
      else if (y > window.innerHeight - 70) window.scrollBy(0, 14)
    }

    function end() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setDragId(null)
      setOrder(null)
      // Letting go over the row would also count as a click on it (and open
      // it), so the one click that follows a drag is swallowed.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      if (current.join('\u0000') !== before.join('\u0000')) onDrop(current)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const byId = new Map(items.map((i) => [i.id, i]))
  const list = order ? order.map((id) => byId.get(id)).filter(Boolean) : items

  const rowRef = (id) => (el) => {
    if (el) rows.current.set(id, el)
    else rows.current.delete(id)
  }

  return { list, dragId, start, rowRef }
}
