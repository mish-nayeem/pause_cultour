import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { updatePassword } from '../lib/auth.js'
import './login.css'

const MIN_PASSWORD = 8

// Where the link in the reset email lands. Supabase turns the link's token into
// a temporary signed-in session; while that exists, the person may choose a new
// password. A visit with no such session (a stale or already-used link) gets
// told to ask for another.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(null) // null = checking, true, false
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    document.title = 'Reset password — PAUSE'

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })

    // The token in the address is exchanged asynchronously; give it a moment
    // before deciding the link is no good.
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true)
      else setTimeout(() => setReady((r) => (r === null ? false : r)), 1500)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError("The two passwords don't match.")
      return
    }

    setSubmitting(true)
    const { error: err } = await updatePassword(password)
    setSubmitting(false)

    if (err) {
      setError(err.message?.toLowerCase().includes('password')
        ? err.message
        : "Couldn't change the password. Try the link again.")
      return
    }

    setDone(true)
    setTimeout(() => navigate('/', { replace: true }), 1800)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-split">
        <Link to="/" className="auth-mark" aria-label="PAUSE — home">
          <img src="/favicon-64.png" alt="PAUSE" width="128" height="128" />
        </Link>

        <div className="auth-rule" />

        <div className="auth-panel">
          <h1 className="auth-title mono">NEW PASSWORD</h1>

          {ready === null && <p className="auth-lead">Checking your link…</p>}

          {ready === false && (
            <>
              <p className="auth-lead">
                This link has expired or was already used. Ask for a new one from the log in page.
              </p>
              <Link to="/login" className="auth-btn mono">Back to log in</Link>
            </>
          )}

          {ready && done && (
            <div className="auth-msg good mono">Password changed. Taking you to the shop…</div>
          )}

          {ready && !done && (
            <form onSubmit={handleSubmit} noValidate>
              <label className="auth-field">
                <span>New password ({MIN_PASSWORD}+ characters)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>

              <label className="auth-field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </label>

              {error && <div className="auth-msg bad mono">{error}</div>}

              <button type="submit" className="auth-btn mono" disabled={submitting}>
                {submitting ? 'Please wait…' : 'Change password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
