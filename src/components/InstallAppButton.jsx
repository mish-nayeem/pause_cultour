import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useInstallApp } from '../lib/adminApp.js'
import './install-app.css'

// Sidebar → "Install app": PAUSE Admin on the phone's home screen (or the
// PC's app list). Android / Chrome / Edge get the browser's own install
// dialog; iPhone, and any browser without one, get the steps instead.
// Hidden once it's running as the installed app.
export default function InstallAppButton() {
  const app = useInstallApp()
  const [help, setHelp] = useState(false)
  const [note, setNote] = useState('')

  if (app.installed) return null

  async function click() {
    if (app.canPrompt) {
      const ok = await app.install()
      setNote(ok ? 'Installed — open PAUSE Admin from your home screen.' : '')
      return
    }
    setHelp(true)
  }

  return (
    <>
      <button type="button" className="signout install-app" onClick={click}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M12 7v7m0 0-3-3m3 3 3-3M10 18h4" /></svg>
        Install app
      </button>
      {note && <div className="install-note mono">{note}</div>}

      {/* On the page itself: the sidebar's own transform would trap a fixed box inside it. */}
      {help && createPortal(
        <div className="install-back" role="dialog" aria-modal="true" aria-label="Install PAUSE Admin" onClick={() => setHelp(false)}>
          <div className="install-card" onClick={(e) => e.stopPropagation()}>
            <img src="/admin-icon-192.png" alt="" className="install-icon" />
            <h3>Install PAUSE Admin</h3>
            <p className="install-lead">The admin as an app on your phone — its own icon, full screen, signed in. Free, nothing from an app store, and it updates by itself with the website.{app.ios ? ' iPhone doesn’t let a website install itself with one tap, so it takes these few steps once.' : ''}</p>
            {app.ios ? (
              <ol>
                <li>Open this page in <b>Safari</b> (not Chrome or the Instagram browser).</li>
                <li>Tap the <b>Share</b> button <span className="install-glyph">⬆︎</span>. On newer iPhones it's inside the <b>•••</b> button at the bottom right: tap <b>•••</b> → <b>Share</b>.</li>
                <li>Scroll down → <b>Add to Home Screen</b> (under “View More” if it isn't showing). If there's an <b>Open as Web App</b> switch, leave it on → <b>Add</b>.</li>
                <li>Open <b>PAUSE Admin</b> from the home screen and sign in once.</li>
              </ol>
            ) : (
              <ol>
                <li><b>Android:</b> open this page in <b>Chrome</b> → menu <b>⋮</b> → <b>Install app</b> (or <b>Add to Home screen</b>) → Install.</li>
                <li><b>PC (Chrome / Edge):</b> the install icon at the right end of the address bar → Install.</li>
                <li>Open <b>PAUSE Admin</b> from the home screen / app list and sign in once.</li>
              </ol>
            )}
            <button type="button" className="install-ok mono" onClick={() => setHelp(false)}>Got it</button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
