import { supabase } from './supabaseClient.js'
import { isIOS, isStandalone } from './adminApp.js'

// "New order" notifications on the admin's phones. The phone subscribes
// through public/admin-sw.js; the notify edge function keeps the list and
// sends them (supabase/functions/notify).

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// iPhone only allows notifications inside the installed app.
export const needsInstallFirst = () => isIOS() && !isStandalone()

async function readError(error, data) {
  let body = data
  if (!body?.error && error?.context?.json) {
    try { body = await error.context.clone().json() } catch { /* not JSON */ }
  }
  const raw = body?.error || error?.message || ''
  if (!raw) return null
  if (/Failed to send a request|NOT_FOUND|404/.test(raw)) return 'The notify function isn’t deployed yet — deploy supabase/functions/notify.'
  if (raw.startsWith('DB:')) return 'Run supabase-migration-push-notifications.sql in Supabase first.'
  if (raw === 'Not allowed') return 'Only the admin account can do this.'
  return raw
}

async function call(body) {
  try {
    const { data, error } = await supabase.functions.invoke('notify', { body })
    const message = await readError(error, data)
    return message ? { data: null, error: message } : { data, error: null }
  } catch (err) {
    return { data: null, error: await readError({ message: err.message }) }
  }
}

function keyBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function registration() {
  const reg = (await navigator.serviceWorker.getRegistration('/admin')) || (await navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' }))
  if (reg.active) return reg
  // Just registered: wait for it to finish installing.
  await new Promise((resolve) => {
    const w = reg.installing || reg.waiting
    if (!w) return resolve()
    w.addEventListener('statechange', () => { if (w.state === 'activated') resolve() })
  })
  return reg
}

// 'on' | 'off' | 'blocked' | 'unsupported'
export async function pushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration('/admin')
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

function deviceLabel() {
  const ua = navigator.userAgent
  if (/iphone/i.test(ua)) return 'iPhone'
  if (/ipad/i.test(ua)) return 'iPad'
  if (/android/i.test(ua)) return 'Android phone'
  return 'Computer'
}

export async function turnOnPush() {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { error: perm === 'denied' ? 'Notifications are blocked for this site — allow them in the phone’s settings, then try again.' : 'Not allowed — tap Allow when the phone asks.' }
  const { data, error } = await call({ action: 'key' })
  if (error) return { error }
  try {
    const reg = await registration()
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      // The phone asks its own push service (Google's / Apple's) — never
      // left spinning if that can't be reached.
      sub = await Promise.race([
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.publicKey) }),
        new Promise((_, no) => setTimeout(() => no(new Error('the phone’s push service didn’t answer — check the internet and try again')), 20000)),
      ])
    }
    const saved = await call({ action: 'subscribe', subscription: sub.toJSON(), label: deviceLabel() })
    return saved.error ? { error: saved.error } : { error: null }
  } catch (e) {
    return { error: `Couldn’t turn them on: ${e.message}` }
  }
}

export async function turnOffPush() {
  const reg = await navigator.serviceWorker.getRegistration('/admin')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return { error: null }
  await call({ action: 'unsubscribe', endpoint: sub.endpoint })
  await sub.unsubscribe()
  return { error: null }
}

export async function sendTestPush() {
  const { data, error } = await call({ action: 'test' })
  if (error) return { error }
  return { error: null, sent: data.sent, phones: data.phones }
}
