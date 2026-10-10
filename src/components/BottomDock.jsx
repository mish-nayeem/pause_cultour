import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import './bottom-dock.css'

// The floating FILTER and CART pills live in a zero-height sticky strip that
// sits right before the footer (the Footer renders <DockSlot />). Sticky
// keeps the strip at the bottom of the screen while scrolling and lets it
// stop at the top of the footer — done by the browser, so it moves with the
// scroll itself instead of chasing it from script (which made it shake).

export function DockSlot() {
  return (
    <div className="dock">
      <div className="dock-inner" id="bottom-dock" />
    </div>
  )
}

// Renders `children` into the dock when the page has one (any page with the
// footer), otherwise in place, where the pill's own CSS fixes it to the
// bottom of the screen.
export function InDock({ children }) {
  const { pathname } = useLocation()
  const [target, setTarget] = useState(null)

  useEffect(() => {
    setTarget(document.getElementById('bottom-dock'))
  }, [pathname])

  return target ? createPortal(children, target) : children
}
