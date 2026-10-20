import { useEffect, useRef, useState } from 'react'
import { DockSlot } from './BottomDock.jsx'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { INSTAGRAM, FACEBOOK, TIKTOK } from '../content/info-pages.js'
import { DEFAULT_FOOTER_ABOUT, fetchFooterAbout } from '../lib/siteSettings.js'
import './footer.css'

// One list of footer links. On a computer it's always open; on a phone its
// heading has a + beside it, and a tap on the heading slides the links open
// under it (the + turns to ×) — one list at a time.
function FootCol({ id, label, open, onToggle, children }) {
  const isOpen = open === id
  return (
    <div className={`foot-col ${isOpen ? 'open' : ''}`}>
      <button
        type="button"
        className="foot-label foot-toggle mono"
        aria-expanded={isOpen}
        aria-controls={`foot-${id}`}
        onClick={() => onToggle(id)}
      >
        {label}
        <span className="foot-plus" aria-hidden="true" />
      </button>
      <div className="foot-links" id={`foot-${id}`}>
        <div className="foot-links-inner">{children}</div>
      </div>
    </div>
  )
}

export default function Footer() {
  // The footer list open on a phone, if any.
  const [open, setOpen] = useState(null)

  // The short about under the newsletter: the built-in words until the
  // saved ones arrive (or for good, if none are saved).
  const [about, setAbout] = useState(DEFAULT_FOOTER_ABOUT)
  useEffect(() => {
    let live = true
    fetchFooterAbout().then((a) => { if (live) setAbout(a) })
    return () => { live = false }
  }, [])
  const colsRef = useRef(null)
  const toggle = (id) => setOpen((cur) => (cur === id ? null : id))

  // A touch anywhere outside the lists closes the open one.
  useEffect(() => {
    if (!open) return
    function away(e) {
      if (colsRef.current && !colsRef.current.contains(e.target)) setOpen(null)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

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

        <div className="foot-cols" ref={colsRef}>
          <FootCol id="shop" label="SHOP" open={open} onToggle={toggle}>
            <Link to="/shop">All products</Link>
            <Link to="/shop?c=NEW">New arrivals</Link>
            <Link to="/cart">Your cart</Link>
            <Link to="/track">Track order</Link>
          </FootCol>

          <FootCol id="support" label="SUPPORT" open={open} onToggle={toggle}>
            <Link to="/support/portal">Return &amp; exchange</Link>
            <Link to="/support/delivery">Delivery info</Link>
            <Link to="/support/contact">Contact us</Link>
          </FootCol>

          <FootCol id="policies" label="POLICIES" open={open} onToggle={toggle}>
            <Link to="/support/refunds">Return &amp; refund</Link>
            <Link to="/support/exchange">Exchange policy</Link>
            <Link to="/support/privacy">Privacy policy</Link>
            <Link to="/support/terms">Terms of service</Link>
          </FootCol>
        </div>
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
