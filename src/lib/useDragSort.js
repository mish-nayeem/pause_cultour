import { useRef, useState } from 'react'

// Reorder a list by dragging a row's handle up or down — mouse or finger.
// Rows carry data-sort-index; while dragging, the list reorders live under
// the pointer, and onDrop gets the new order once it's let go.
//
//   const drag = useDragSort(items, setItems, (next) => save(next))
//   <div {...drag.row(i)}> <span {...drag.handle(i)}>⋮⋮</span> … </div>
export default function useDragSort(items, setItems, onDrop) {
  const [dragging, setDragging] = useState(null)
  const from = useRef(null)
  const moved = useRef(false)
  const latest = useRef(items)
  latest.current = items

  function down(i, e) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    from.current = i
    moved.current = false
    setDragging(i)
  }

  function move(e) {
    if (from.current === null) return
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sort-index]')
    if (!row) return
    const to = Number(row.dataset.sortIndex)
    const at = from.current
    if (Number.isNaN(to) || to === at) return
    const next = [...latest.current]
    const [item] = next.splice(at, 1)
    next.splice(to, 0, item)
    from.current = to
    moved.current = true
    latest.current = next
    setDragging(to)
    setItems(next)
  }

  function up() {
    if (from.current === null) return
    from.current = null
    setDragging(null)
    if (moved.current) onDrop(latest.current)
  }

  return {
    dragging,
    row: (i) => ({ 'data-sort-index': i }),
    handle: (i) => ({
      onPointerDown: (e) => down(i, e),
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: up,
      style: { touchAction: 'none', cursor: dragging === null ? 'grab' : 'grabbing' },
      role: 'button',
      'aria-label': 'Drag to reorder',
      title: 'Drag to reorder',
    }),
  }
}
