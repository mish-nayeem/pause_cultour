import { useEffect, useState } from 'react'
import { useLive } from '../lib/liveSite.js'
import { DockSlot } from './BottomDock.jsx'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { INSTAGRAM, FACEBOOK, TIKTOK } from '../content/info-pages.js'
import { DEFAULT_FOOTER_ABOUT, fetchFooterAbout } from '../lib/siteSettings.js'
import './footer.css'

export default function Footer() {
  // The short about under the newsletter: the built-in words until the
  // saved ones arrive (or for good, if none are saved).
  const [about, setAbout] = useState(DEFAULT_FOOTER_ABOUT)
  // Ticks when the admin changes something: re-read below.
  const changed = useLive()
  useEffect(() => {
    let live = true
    fetchFooterAbout().then((a) => { if (live) setAbout(a) })
    return () => { live = false }
  }, [changed])

  const [email, setEmail] = useState('')
  const [state, setState] = useState('idle') // idle | saving | done | error
  const [message, setMessage] = useState('')

  async function handleSubscribe(e) {
    e.preventDefault()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setState('error')
      setMessage('Enter a valid email address.')
      return
    }

    setState('saving')
    setMessage('')

    const { error } = await supabase
      .from('subscribers')
      .insert({ email: email.trim().toLowerCase() })

    if (error) {
      // A duplicate means they're already on the list — that's a success from
      // the visitor's point of view, not something to show as a failure.
      if (error.code === '23505') {
        setState('done')
        setMessage("You're already on the list.")
        setEmail('')
        return
      }
      setState('error')
      setMessage("Couldn't sign you up right now. Try again in a moment.")
      console.error('[Supabase] subscribe failed:', error.message)
      return
    }

    setState('done')
    setMessage("You're in. Watch your inbox for the next drop.")
    setEmail('')
  }

  return (
    <>
    <DockSlot />
    <footer className="site-footer">
      <div className="foot-main">
        <div className="foot-left">
          <div className="foot-top">
            <h3 className="display">Join the list</h3>
            <form className="sub-form" onSubmit={handleSubscribe}>
              <input
                type="email"
                className="sub-input"
                placeholder="Email address"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (state !== 'idle') setState('idle')
                }}
                aria-label="Email address"
              />
              <button type="submit" className="sub-btn mono" disabled={state === 'saving'}>
                {state === 'saving' ? 'Joining…' : 'Join'}
              </button>
            </form>
            {message && (
              <div className={`sub-msg mono ${state === 'error' ? 'bad' : 'good'}`}>{message}</div>
            )}
          </div>

          {/* Set in Admin → Homepage → Footer text. */}
          <div className="foot-about">
            <div className="foot-label mono">{about.heading}</div>
            <p>{about.text}</p>
          </div>
        </div>

        {/* One row of help links: each opens its own page. SUPPORT opens the
            support pages with their tab row (Admin → Support → Support pages). */}
        <nav className="foot-help" aria-label="Help">
          <Link to="/track">Track order</Link>
          <Link to="/support">Support</Link>
          <Link to="/support/privacy">Privacy policy</Link>
          <Link to="/support/terms">Terms of service</Link>
          <Link to="/support/portal">Return &amp; exchange portal</Link>
        </nav>
      </div>

      <div className="foot-base">
        <div className="socials">
          <a href={INSTAGRAM} target="_blank" rel="noreferrer" aria-label="Instagram">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
            </svg>
          </a>
          <a href={FACEBOOK} target="_blank" rel="noreferrer" aria-label="Facebook">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 3h-2.5A4.5 4.5 0 0 0 8 7.5V11H5v4h3v6h4v-6h3l1-4h-4V7.5a1 1 0 0 1 1-1H16V3Z" />
            </svg>
          </a>
          <a href={TIKTOK} target="_blank" rel="noreferrer" aria-label="TikTok">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M16 3c.5 2.5 2 4 4.5 4.2V11c-1.8 0-3.3-.5-4.5-1.4V15a6 6 0 1 1-6-6c.4 0 .7 0 1 .1v3.3A2.7 2.7 0 1 0 13 15V3h3Z" />
            </svg>
          </a>
        </div>
        <a href={INSTAGRAM} target="_blank" rel="noreferrer" className="foot-brand" aria-label="PAUSE on Instagram">
          <img src="/footer-handle.png" alt="@pause.cultour" width="668" height="128" loading="lazy" />
        </a>
        <div className="foot-fine mono">© {new Date().getFullYear()} PAUSE · DHAKA, BD</div>
      </div>
    </footer>
    </>
  )
}
