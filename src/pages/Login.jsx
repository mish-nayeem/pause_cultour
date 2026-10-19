import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { sendLoginCode, verifyLoginCode, signInWithGoogle } from '../lib/auth.js'
import { setRemember } from '../lib/sessionPolicy.js'
import './login.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Supabase's own wait between two codes to the same address.
const RESEND_AFTER = 60

// The button only appears once Google is switched on in Supabase — before that
// it would send people to an error page.
const GOOGLE_ON = import.meta.env.VITE_GOOGLE_LOGIN === 'true'

// Only same-site paths — a `next` of "//evil.com" or "https://…" would turn the
// login page into an open redirect.
function safeNext(raw) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null
}

function sendMessage(error) {
  const raw = (error?.message || '').toLowerCase()
  if (raw.includes('after') && raw.includes('second')) return 'A code was just sent — wait a minute before asking for another.'
  if (raw.includes('rate limit')) return 'Too many codes asked for. Try again in a few minutes.'
  if (raw.includes('signups not allowed') || raw.includes('signup is disabled')) {
    return "Account creation isn't open yet."
  }
  return "Couldn't send the code right now. Try again in a moment."
}

// Supabase answers a wrong code and an expired one the same way.
function verifyMessage() {
  return "That code is wrong or has expired. Check the email, or send a new one."
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

  const [step, setStep] = useState('email') // email | code
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRememberMe] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [wait, setWait] = useState(0)
  const codeInput = useRef(null)

  useEffect(() => {
    document.title = 'Log in — PAUSE'
  }, [])

  // Counts down to when another code can be asked for.
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  useEffect(() => {
    if (step === 'code') codeInput.current?.focus()
  }, [step])

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

  async function send() {
    setError('')
    setNotice('')
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setSubmitting(true)
    const { error: err } = await sendLoginCode(email)
    setSubmitting(false)
    if (err) {
      setError(sendMessage(err))
      return
    }
    setCode('')
    setStep('code')
    setWait(RESEND_AFTER)
    setNotice(`We've emailed a code to ${email.trim().toLowerCase()}.`)
  }

  async function verify() {
    setError('')
    const clean = code.replace(/\D/g, '')
    if (clean.length < 6) {
      setError('Enter the code from the email.')
      return
    }
    setSubmitting(true)
    const { session, isAdmin, error: err } = await verifyLoginCode(email, clean)
    setSubmitting(false)
    if (err || !session) {
      setError(verifyMessage(err))
      return
    }
    setRemember(remember)
    landOn(isAdmin)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (step === 'email') send()
    else verify()
  }

  function changeEmail() {
    setStep('email')
    setCode('')
    setError('')
    setNotice('')
  }

  return (
    <div className="auth-wrap">
      <div className="auth-split">
        <Link to="/" className="auth-mark" aria-label="PAUSE — home">
          <img src="/favicon-64.png" alt="PAUSE" width="128" height="128" />
        </Link>

        <div className="auth-rule" />

        <div className="auth-panel">
          <h1 className="auth-title mono">{step === 'code' ? 'ENTER YOUR CODE' : 'LOG IN'}</h1>

          <form onSubmit={handleSubmit} noValidate>
            {step === 'email' && GOOGLE_ON && (
              <>
                <button type="button" className="auth-google" onClick={handleGoogle}>
                  <GoogleMark />
                  <span>Sign in with Google</span>
                </button>
                <div className="auth-or mono"><span>OR WITH YOUR EMAIL</span></div>
              </>
            )}

            {step === 'email' && (
              <>
                <p className="auth-lead">
                  No password needed — we'll email you a one-time code. New here? The same code
                  creates your account.
                </p>
                <label className="auth-field">
                  <span>Email address</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    inputMode="email"
                  />
                </label>
              </>
            )}

            {step === 'code' && (
              <label className="auth-field">
                <span>Code from the email</span>
                <input
                  ref={codeInput}
                  className="auth-code mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                />
              </label>
            )}

            {error && <div className="auth-msg bad mono">{error}</div>}
            {notice && !error && <div className="auth-msg good mono">{notice}</div>}

            <button type="submit" className="auth-btn mono" disabled={submitting}>
              {submitting ? 'Please wait…' : step === 'email' ? 'Send code' : 'Log in'}
            </button>

            <div className="auth-row">
              <label className="auth-check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>Remember me</span>
              </label>
              {step === 'code' && (
                <button type="button" className="auth-link mono" onClick={send} disabled={wait > 0 || submitting}>
                  {wait > 0 ? `Resend in ${wait}s` : 'Send a new code'}
                </button>
              )}
            </div>
          </form>

          {step === 'code' && (
            <div className="auth-switch">
              Wrong address? <button type="button" onClick={changeEmail}>Use another email</button>
            </div>
          )}

          <div className="auth-foot mono">
            <Link to="/shop">Back to shop</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
