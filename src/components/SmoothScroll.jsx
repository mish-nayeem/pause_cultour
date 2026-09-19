import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { startSmoothScroll, jumpToTop } from '../lib/smoothScroll.js'

// Turns on smooth scrolling for every page, and sends each new page to the
// top. Rendered once, inside the router.
export default function SmoothScroll() {
  const { pathname } = useLocation()

  useEffect(() => startSmoothScroll(), [])
  useEffect(() => { jumpToTop() }, [pathname])

  return null
}
