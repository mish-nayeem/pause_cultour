import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './bottom-dock.css'

// The shop's floating FILTER pill lives in a zero-height sticky strip that
// sits right before the footer (the Footer renders <DockSlot />). Sticky
// keeps the strip at the bottom of the screen while scrolling and lets it
// stop at the top of the footer — done by the browser, so it moves with the
// scroll itself instead of chasing it from script (which made it shake).

// The slot tells the pill when it appears or goes away — the footer can
// show up after the pill is already on screen, so looking for the slot once
// isn't enough.
let slot = null
const listeners = new Set()

function setSlot(el) {
  slot = el
  listeners.forEach((fn) => fn(el))
}

export function DockSlot() {
  return (
    <div className="dock">
      <div className="dock-inner" ref={setSlot} />
    </div>
  )
}

// Renders `children` into the dock when the page has one (any page with the
// footer), otherwise in place, where the pill's own CSS fixes it to the
// bottom of the screen.
export function InDock({ children }) {
  const [target, setTarget] = useState(slot)

  useEffect(() => {
    setTarget(slot)
    listeners.add(setTarget)
    return () => { listeners.delete(setTarget) }
  }, [])

  return target ? createPortal(children, target) : children
}
