import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageView } from '../lib/analytics.js'

// Rendered once, inside the router — a client-side route change never
// reloads the page, so this is the only thing that would otherwise notice
// one happened.
export default function PageViewTracker() {
  const location = useLocation()

  useEffect(() => {
    trackPageView(location.pathname)
  }, [location.pathname])

  return null
}
