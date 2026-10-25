import { useEffect, useState } from 'react'

// The admin as an installed app (PAUSE Admin) on Android, iPhone and PC.
// worker/index.js writes the app tags into /admin pages; this adds the same
// ones when the admin is opened from inside the shop without a reload,
// registers public/admin-sw.js, and keeps the browser's install offer for
// the "Install app" button.

let offer = null // Chrome / Android / Edge's beforeinstallprompt event
const listeners = new Set()
const tell = () => listeners.forEach((f) => f())

// Listened for from the first page load (main.jsx imports this), since the
// offer arrives once, often before the admin's own code has loaded.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    offer = e
    tell()
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    tell()
  })
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)

// iPhone / iPad Safari: no install offer, only Share → Add to Home Screen.
export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

const TAGS = [
  ['link', { rel: 'manifest', href: '/admin.webmanifest' }],
  ['meta', { name: 'mobile-web-app-capable', content: 'yes' }],
  ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
  ['meta', { name: 'apple-mobile-web-app-title', content: 'PAUSE Admin' }],
  ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }],
]

// Called by the admin page while it's open. Returns the clean-up, which
// takes back only the tags this call added, so the shop isn't installable.
export function startAdminApp() {
  const added = []
  for (const [tag, attrs] of TAGS) {
    const key = attrs.rel ? `link[rel="${attrs.rel}"]` : `meta[name="${attrs.name}"]`
    if (document.head.querySelector(key)) continue
    const el = document.createElement(tag)
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
    document.head.appendChild(el)
    added.push(el)
  }
  const icon = document.head.querySelector('link[rel="apple-touch-icon"]')
  const oldIcon = icon?.getAttribute('href')
  if (icon) icon.setAttribute('href', '/admin-apple-touch-icon.png')

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' }).catch((err) => {
      console.warn('[AdminApp] service worker not registered:', err.message)
    })
  }

  return () => {
    added.forEach((el) => el.remove())
    if (icon && oldIcon) icon.setAttribute('href', oldIcon)
  }
}

// { installed, canPrompt, ios, install() } for the Install button.
export function useInstallApp() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    listeners.add(f)
    return () => listeners.delete(f)
  }, [])
  return {
    installed: isStandalone(),
    canPrompt: Boolean(offer),
    ios: isIOS(),
    async install() {
      if (!offer) return false
      offer.prompt()
      const { outcome } = await offer.userChoice
      offer = null
      tell()
      return outcome === 'accepted'
    },
  }
}
