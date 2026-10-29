import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient.js'
import { clearPromoCache } from './promos.js'
import { clearSalesCache } from './sales.js'

// The site updates itself, no reload needed:
//
// 1. Admin changes. A save in the admin panel (supabaseClient.js notices it)
//    is broadcast on a Supabase Realtime channel. Every open shop tab hears
//    it, drops its kept copies and fetches again — the pages showing shop
//    data re-read when `useLive()` ticks, in place, without a reload.
// 2. New deploys. Every few minutes, and when the tab comes back to the
//    front, the page checks whether the site has a newer build. If it does,
//    the next link tapped loads the new build (the admin gets a Refresh pill
//    instead, so a half-filled form is never lost).

const CHANNEL = 'site-live'
const EVENT = 'changed'
const LiveContext = createContext(0)

let channel = null
const heard = new Set()
function getChannel() {
  if (!channel) {
    channel = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } })
    channel.on('broadcast', { event: EVENT }, () => heard.forEach((fn) => fn()))
    channel.subscribe()
  }
  return channel
}

// Admin side: tell the open shop tabs, once a burst of saves settles.
let sendTimer = null
if (typeof window !== 'undefined') {
  window.addEventListener('pause:shop-changed', () => {
    clearTimeout(sendTimer)
    sendTimer = setTimeout(() => {
      getChannel().send({ type: 'broadcast', event: EVENT, payload: { at: Date.now() } })
    }, 1200)
  })
}

// The build this page is running: the hashed script the HTML points at.
function scriptOf(html) {
  const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/) || html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)
  return m ? m[1] : null
}
const running = typeof document === 'undefined' ? null
  : (document.querySelector('script[type="module"][src]')?.getAttribute('src') || null)

async function newerBuild() {
  if (!running) return false
  try {
    const res = await fetch('/', { cache: 'no-store', headers: { accept: 'text/html' } })
    if (!res.ok) return false
    const src = scriptOf(await res.text())
    return Boolean(src) && src !== running
  } catch {
    return false
  }
}

export function LiveSite({ children }) {
  const [tick, setTick] = useState(0)
  const [stale, setStale] = useState(false)
  const location = useLocation()
  const first = useRef(true)
  const isAdmin = location.pathname.startsWith('/admin')

  // Shop tabs listen for the admin's changes.
  useEffect(() => {
    let timer = null
    const onChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        clearPromoCache()
        clearSalesCache()
        setTick((t) => t + 1)
      }, 400)
    }
    heard.add(onChange)
    getChannel()
    return () => { clearTimeout(timer); heard.delete(onChange) }
  }, [])

  // A newer build: look now and then, and whenever the tab comes back.
  useEffect(() => {
    let off = false
    const check = () => { newerBuild().then((yes) => { if (yes && !off) setStale(true) }) }
    const onShow = () => { if (document.visibilityState === 'visible') check() }
    const id = setInterval(check, 3 * 60_000)
    document.addEventListener('visibilitychange', onShow)
    return () => { off = true; clearInterval(id); document.removeEventListener('visibilitychange', onShow) }
  }, [])

  // On the shop, the next page change loads the new build.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (stale && !isAdmin) window.location.reload()
  }, [location.pathname])

  return createElement(
    LiveContext.Provider,
    { value: tick },
    children,
    stale && isAdmin
      ? createElement('button', { type: 'button', className: 'live-refresh mono', onClick: () => window.location.reload() }, 'New version — tap to refresh')
      : null,
  )
}

// Changes whenever the admin has changed something; put it in the deps of an
// effect that fetches shop data and the page re-reads it in place.
export function useLive() {
  return useContext(LiveContext)
}
