import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'

// The link in a password-reset email should end on /reset-password, but where
// it actually lands is up to Supabase: if the address it was asked to return to
// isn't on the project's Redirect URLs list, it falls back to the Site URL —
// usually the homepage — with the same tokens in the address. Either way the
// visitor is holding a recovery link, so wherever it lands this sends them on
// to choose a new password rather than leaving them on a page that ignores it.
//
// Read at load, before Supabase strips the tokens out of the address.
const ARRIVED_FROM_RESET_LINK =
  typeof window !== 'undefined' && /type=recovery/.test(window.location.hash)

export default function RecoveryRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    if (ARRIVED_FROM_RESET_LINK && window.location.pathname !== '/reset-password') {
      navigate('/reset-password', { replace: true })
    }

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && window.location.pathname !== '/reset-password') {
        navigate('/reset-password', { replace: true })
      }
    })

    return () => data.subscription.unsubscribe()
  }, [navigate])

  return null
}
