import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { pushSupported, needsInstallFirst, pushState, turnOnPush, turnOffPush, sendTestPush } from '../lib/adminPush.js'
import './install-app.css'

// Sidebar → Notifications: "🛍 New order" on this phone the moment an order
// comes in — even with the app closed. Each phone turns it on for itself.
export default function NotifyButton() {
  const [state, setState] = useState('off')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { pushState().then(setState) }, [open])

  async function run(fn, done) {
    setBusy(true)
    setErr('')
    setNote('')
    const r = await fn()
    setBusy(false)
    if (r.error) return setErr(r.error)
    done?.(r)
    setState(await pushState())
  }

  const sentNote = (r) => setNote(`Test sent to ${r.sent} of ${r.phones} phone${r.phones === 1 ? '' : 's'} — it should show in a few seconds.`)

  // On, then a test straight away so it's plain it works.
  async function turnOn() {
    await run(turnOnPush)
    if ((await pushState()) === 'on') await run(sendTestPush, sentNote)
  }

  const word = state === 'on' ? 'On' : state === 'blocked' ? 'Blocked' : 'Off'

  return (
    <>
      <button type="button" className="signout install-app" onClick={() => setOpen(true)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        Notifications: {word}
      </button>

      {open && createPortal(
        <div className="install-back" role="dialog" aria-modal="true" aria-label="Notifications" onClick={() => setOpen(false)}>
          <div className="install-card" onClick={(e) => e.stopPropagation()}>
            <img src="/admin-icon-192.png" alt="" className="install-icon" />
            <h3>New order notifications</h3>
            <p className="install-lead">A notification on this phone the moment an order comes in — “🛍 New order · ৳2,480”, even with the app closed. Tap it to open that order. Turn it on once on each phone.</p>

            {!pushSupported() || needsInstallFirst() ? (
              <ol>
                {needsInstallFirst() ? (
                  <>
                    <li>iPhone only allows notifications in the installed app: Safari → Share ⬆︎ → <b>Add to Home Screen</b>.</li>
                    <li>Open <b>PAUSE Admin</b> from the home screen, sign in, and come back here.</li>
                  </>
                ) : (
                  <li>This browser can't show notifications — open the admin in Chrome (Android / PC) or the installed app on iPhone.</li>
                )}
              </ol>
            ) : (
              <>
                <div className={`notify-state ${state}`}>
                  {state === 'on' && '✓ On for this phone'}
                  {state === 'off' && 'Off for this phone'}
                  {state === 'blocked' && 'Blocked — allow notifications for this site in the phone’s settings (Settings → Notifications), then come back.'}
                </div>
                <div className="notify-acts">
                  {state !== 'on' && <button type="button" className="install-ok mono" disabled={busy || state === 'blocked'} onClick={turnOn}>{busy ? 'Turning on…' : 'Turn on notifications'}</button>}
                  {state === 'on' && (
                    <>
                      <button type="button" className="install-ok mono" disabled={busy} onClick={() => run(sendTestPush, sentNote)}>{busy ? 'Sending…' : 'Send a test'}</button>
                      <button type="button" className="notify-off mono" disabled={busy} onClick={() => run(turnOffPush, () => setNote('Turned off for this phone.'))}>Turn off</button>
                    </>
                  )}
                </div>
              </>
            )}
            {note && <div className="notify-note mono">{note}</div>}
            {err && <div className="notify-err mono">{err}</div>}
            <button type="button" className="notify-off mono" style={{ marginTop: 12 }} onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
