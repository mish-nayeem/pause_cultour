import { useState } from 'react'
import { signIn } from '../lib/admin.js'
import './admin-login.css'

export default function AdminLogin({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }

    setSubmitting(true)
    setError('')

    const { session, error: signInError } = await signIn(email, password)

    setSubmitting(false)

    if (signInError?.message === 'not_admin') {
      setError('This account does not have admin access.')
      return
    }

    if (signInError || !session) {
      setError('Login failed — check your email and password.')
      return
    }

    onSignedIn(session)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand display">PAUSE</div>
        <div className="login-label mono">ADMIN ACCESS</div>

        <label className="fl mono" htmlFor="admin-email">EMAIL</label>
        <input
          id="admin-email"
          type="email"
          className="fi mono"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />

        <label className="fl mono" htmlFor="admin-password">PASSWORD</label>
        <input
          id="admin-password"
          type="password"
          className="fi mono"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error && <div className="login-err mono">{error}</div>}

        <button type="submit" className="login-btn mono" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="login-note mono">
          Accounts are created from the Supabase dashboard — Authentication → Users.
        </div>
      </form>
    </div>
  )
}
