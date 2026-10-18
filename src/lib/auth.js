import { supabase } from './supabaseClient.js'
import { isAdminEmail } from './admin.js'
import { clearRemember } from './sessionPolicy.js'

// One login for everyone. Whether the account is the admin's is decided by the
// same email allowlist the admin panel uses — the caller sends admins to
// /admin and everyone else back to the storefront.

// Log in with a one-time code — no password to remember. The same call
// creates the account the first time an address is used. Supabase emails a
// code (through the send-auth-email hook, see supabase/functions), which
// verifyLoginCode then trades for a session.
export async function sendLoginCode(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
      // The link in the same mail, for anyone who taps it instead of typing
      // the code. Has to be on the project's allowed Redirect URLs list.
      emailRedirectTo: `${window.location.origin}/account`,
    },
  })

  if (error) console.error('[Supabase] sendLoginCode failed:', error.message)
  return { error }
}

export async function verifyLoginCode(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'email',
  })

  if (error) {
    console.error('[Supabase] verifyLoginCode failed:', error.message)
    return { session: null, isAdmin: false, error }
  }

  return {
    session: data.session,
    isAdmin: isAdminEmail(data.session?.user?.email),
    error: null,
  }
}

export async function currentUser() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user || null
}

export async function signOutUser() {
  clearRemember()
  await supabase.auth.signOut()
}

// Fires with the user (or null) now and on every later sign-in / sign-out.
// Returns the unsubscribe function.
export function watchUser(callback) {
  supabase.auth.getSession().then(({ data }) => callback(data.session?.user || null))
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null)
  })
  return () => data.subscription.unsubscribe()
}

// Google sign-in. Needs the Google provider switched on in Supabase
// (Authentication → Sign In / Providers) — until then this comes back with an
// error and nothing else happens. The browser leaves for Google and returns to
// /account, where the person can carry on.
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/account` },
  })

  if (error) console.error('[Supabase] signInWithGoogle failed:', error.message)
  return { error }
}

// Only the /reset-password page still uses this, for a reset link mailed
// before logins moved to one-time codes.
export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password })

  if (error) console.error('[Supabase] updatePassword failed:', error.message)
  return { error }
}
