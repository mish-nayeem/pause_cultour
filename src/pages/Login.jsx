import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signInUser, signUpUser, signInWithGoogle, sendPasswordReset } from '../lib/auth.js'
import { setRemember } from '../lib/sessionPolicy.js'
import './login.css'

const MIN_PASSWORD = 8
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// The button only appears once Google is switched on in Supabase — before that
// it would send people to an error page.
const GOOGLE_ON = import.meta.env.VITE_GOOGLE_LOGIN === 'true'

// Only same-site paths — a `next` of "//evil.com" or "https://…" would turn the
// login page into an open redirect.
function safeNext(raw) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null
}

function signInMessage(error) {
  const raw = (error?.message || '').toLowerCase()
  if (raw.includes('email not confirmed')) {
    return 'Confirm your email first — check your inbox for the link.'
  }
  return 'Login failed — check your email and password.'
}

function signUpMessage(error) {
  const raw = (error?.message || '').toLowerCase()
  if (error?.message === 'already_registered' || raw.includes('already registered')) {
    return 'That email already has an account. Log in instead.'
  }
  if (raw.includes('signups not allowed') || raw.includes('signup is disabled')) {
    return "Account creation isn't open yet."
  }
  if (raw.includes('password')) return error.message
  return "Couldn't create the account right now. Try again in a moment."
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6Z" />
      <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2Z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48Z" />
    </svg>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [mode, setMode] = useState('signin') // signin | signup | forgot
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRememberMe] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = 'Log in — PAUSE'
  }, [])

  function switchMode(m) {
    setMode(m)
    setError('')
    setNotice('')
  }

  function landOn(isAdmin) {
    if (isAdmin) navigate(next || '/admin', { replace: true })
    else navigate(next && next !== '/admin' ? next : '/', { replace: true })
  }

  async function handleGoogle() {
    setError('')
    setRemember(remember)
    const { error: err } = await signInWithGoogle()
    if (err) setError("Google sign-in isn't available right now.")
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setNotice('')

    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }

    if (mode === 'forgot') {
      setSubmitting(true)
      await sendPasswordReset(email)
      setSubmitting(false)
      // Same answer whether or not the address has an account.
      setNotice('If that email has an account, a reset link is on its way.')
      return
    }

    if (mode === 'signup' && !name.trim()) {
      setError('Enter your name.')
      return
    }
    if (!password) {
      setError('Enter your password.')
      return
    }
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters.`)
      return
    }

    setSubmitting(true)

    if (mode === 'signin') {
      const { session, isAdmin, error: err } = await signInUser(email, password)
      setSubmitting(false)
      if (err || !session) {
        setError(signInMessage(err))
        return
      }
      setRemember(remember)
      landOn(isAdmin)
      return
    }

    const { session, isAdmin, error: err } = await signUpUser({ name, email, password })
    setSubmitting(false)

    if (err) {
      setError(signUpMessage(err))
      return
    }

    // No session: the project wants the email confirmed before the first login.
    if (!session) {
      setPassword('')
      setNotice('Account created. Check your inbox to confirm your email, then log in.')
      setMode('signin')
      return
    }

    setRemember(true)
    landOn(isAdmin)
  }

  const title = mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Log in'

  return (
    <div className="auth-wrap">
      <div className="auth-split">
        <Link to="/" className="auth-mark" aria-label="PAUSE — home">
          <img src="/favicon-64.png" alt="PAUSE" width="128" height="128" />
        </Link>

        <div className="auth-rule" />

        <div className="auth-panel">
          <h1 className="auth-title mono">{title.toUpperCase()}</h1>

          <form onSubmit={handleSubmit} noValidate>
            {mode !== 'forgot' && GOOGLE_ON && (
              <button type="button" className="auth-google" onClick={handleGoogle}>
                <GoogleMark />
                <span>{mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}</span>
              </button>
            )}

            {mode === 'forgot' && (
              <p className="auth-lead">
                Enter the email you signed up with and we'll send you a link to choose a new password.
              </p>
            )}

            {mode === 'signup' && (
              <label className="auth-field">
                <span>Full name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </label>
            )}

            <label className="auth-field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>

            {mode !== 'forgot' && (
              <label className="auth-field">
                <span>Password{mode === 'signup' ? ` (${MIN_PASSWORD}+ characters)` : ''}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
              </label>
            )}

            {error && <div className="auth-msg bad mono">{error}</div>}
            {notice && <div className="auth-msg good mono">{notice}</div>}

            <button type="submit" className="auth-btn mono" disabled={submitting}>
              {submitting
                ? 'Please wait…'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : 'Log in'}
            </button>

            {mode === 'signin' && (
              <div className="auth-row">
                <label className="auth-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
                <button type="button" className="auth-link mono" onClick={() => switchMode('forgot')}>
                  I forgot my password
                </button>
              </div>
            )}
          </form>

          <div className="auth-switch">
            {mode === 'signin' && (
              <>
                I'm new here.{' '}
                <button type="button" onClick={() => switchMode('signup')}>Create an account</button>
              </>
            )}
            {mode === 'signup' && (
              <>
                Already have an account.{' '}
                <button type="button" onClick={() => switchMode('signin')}>Log in</button>
              </>
            )}
            {mode === 'forgot' && (
              <button type="button" onClick={() => switchMode('signin')}>Back to log in</button>
            )}
          </div>

          <div className="auth-foot mono">
            <Link to="/shop">Back to shop</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
