// Browser security headers for every page the site serves. Two places send
// them: public/_headers for the static assets Cloudflare serves directly
// (generated from this list at build time by scripts/generate-headers.mjs),
// and worker/index.js for /product/*, which runs through the Worker first
// (wrangler.jsonc's run_worker_first) — Cloudflare doesn't apply _headers to
// a response the Worker builds itself.
//
// The CSP allows exactly what the app loads from outside its own origin:
//   Supabase      — data, auth and edge functions (https + wss for realtime)
//   Cloudinary    — admin image uploads (api.) and product photos (res.)
//   Google Fonts  — the stylesheet and the font files
//   Sentry        — error reports
// Images are left open to any https host so an old placeholder URL on a
// product never renders as a broken picture. A new third-party script,
// pixel or API has to be added here, or the browser will block it.

const SUPABASE = 'rzylwwrpzkqjyxxkstjo.supabase.co'

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://${SUPABASE} wss://${SUPABASE} https://api.cloudinary.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ')

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

export function withSecurityHeaders(response) {
  const res = new Response(response.body, response)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value)
  return res
}
