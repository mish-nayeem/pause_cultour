import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// The admin panel's sections, sub-tabs and open forms are page state, not
// separate addresses — so a phone's Back button used to leave the panel
// altogether. This keeps each step in the browser history instead: opening
// something adds an entry, Back (the phone's, the browser's or the panel's
// own) steps back one, and closing a form you just opened takes you back
// rather than piling up a new entry.
//
// `view` is a plain object describing where the panel is; `apply(view)` puts
// the panel back there. Returns `depth` (how many steps in) and `back()`.
export default function useAdminHistory(view, apply) {
  const navigate = useNavigate()
  const location = useLocation()
  const key = JSON.stringify(view)
  const stack = useRef(null)
  const at = useRef(0)
  const current = useRef(key)
  current.current = key
  const applyRef = useRef(apply)
  applyRef.current = apply

  // First visit: this entry is the bottom of the panel's history.
  useEffect(() => {
    stack.current = [key]
    at.current = 0
    navigate(location.pathname + location.search, { replace: true, state: { adminAt: 0, adminView: key } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The panel moved somewhere new: one step forward — or, if it's where the
  // previous step was (a form closed), one step back.
  useEffect(() => {
    if (!stack.current || stack.current[at.current] === key) return
    if (at.current > 0 && stack.current[at.current - 1] === key) {
      navigate(-1)
      return
    }
    stack.current = [...stack.current.slice(0, at.current + 1), key]
    at.current += 1
    navigate(location.pathname + location.search, { state: { adminAt: at.current, adminView: key } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Back or Forward landed on one of the panel's entries: show that step.
  useEffect(() => {
    const st = location.state
    if (!st || typeof st.adminAt !== 'number' || !stack.current) return
    at.current = st.adminAt
    // After a reload the list of steps is gone; the entry still says where.
    if (!stack.current[st.adminAt]) stack.current[st.adminAt] = st.adminView
    if (st.adminView !== current.current) applyRef.current(JSON.parse(st.adminView))
  }, [location.key, location.state])

  return {
    // Steps back from the bottom entry — there's somewhere in the panel to
    // go back to.
    depth: typeof location.state?.adminAt === 'number' ? location.state.adminAt : 0,
    back: () => navigate(-1),
  }
}
