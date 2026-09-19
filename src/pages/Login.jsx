import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signInUser, signUpUser } from '../lib/auth.js'
import './login.css'

const MIN_PASSWORD = 8

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
    return 'That email already has an account. Sign in instead.'
  }
  if (raw.includes('signups not allowed') || raw.includes('signup is disabled')) {
    return "Account creation isn't open yet."
  }
  if (raw.includes('password')) return error.message
  return "Couldn't create the account right now. Try again in a moment."
}

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [mode, setMode] = useState('signin') // signin | signup
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setNotice('')

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('Enter a valid email address.')
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
      setNotice('Account created. Check your inbox to confirm your email, then sign in.')
      setMode('signin')
      return
    }

    landOn(isAdmin)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-split">
        <Link to="/" className="auth-mark" aria-label="PAUSE — home">
          <img src="/favicon-64.png" alt="PAUSE" width="128" height="128" />
        </Link>

        <div className="auth-rule" />

        <div className="auth-panel">
          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-tabs mono" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                className={mode === 'signin' ? 'on' : ''}
                onClick={() => switchMode('signin')}
              >
                SIGN IN
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                className={mode === 'signup' ? 'on' : ''}
                onClick={() => switchMode('signup')}
              >
                CREATE ACCOUNT
              </button>
            </div>

            {mode === 'signup' && (
              <input
                type="text"
                className="auth-input"
                placeholder="Full name"
                aria-label="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            )}

            <input
              type="email"
              className="auth-input"
              placeholder="Email address"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />

            <input
              type="password"
              className="auth-input"
              placeholder={mode === 'signup' ? `Password (${MIN_PASSWORD}+ characters)` : 'Password'}
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />

            {error && <div className="auth-msg bad mono">{error}</div>}
            {notice && <div className="auth-msg good mono">{notice}</div>}

            <button type="submit" className="auth-btn mono" disabled={submitting}>
              {submitting
                ? mode === 'signin' ? 'Signing in…' : 'Creating…'
                : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            <div className="auth-foot mono">
              <Link to="/shop">Back to shop</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
