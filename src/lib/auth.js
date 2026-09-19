import { supabase } from './supabaseClient.js'
import { isAdminEmail } from './admin.js'

// One login for everyone. Whether the account is the admin's is decided by the
// same email allowlist the admin panel uses — the caller sends admins to
// /admin and everyone else back to the storefront.

export async function signInUser(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  if (error) {
    console.error('[Supabase] signInUser failed:', error.message)
    return { session: null, isAdmin: false, error }
  }

  return {
    session: data.session,
    isAdmin: isAdminEmail(data.session?.user?.email),
    error: null,
  }
}

// `session` comes back null when the project requires email confirmation —
// the account exists, but can't sign in until the link in the inbox is opened.
export async function signUpUser({ name, email, password }) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { full_name: name.trim() },
      // Where the link in the confirmation mail lands. Has to be on the
      // project's allowed Redirect URLs list in Supabase.
      emailRedirectTo: `${window.location.origin}/account`,
    },
  })

  if (error) {
    console.error('[Supabase] signUpUser failed:', error.message)
    return { session: null, isAdmin: false, error }
  }

  // Supabase answers a sign-up for an address that already has an account with
  // a user that has no identities, instead of an error, so a repeat sign-up
  // can't be used to find out who is registered.
  if (data.user && data.user.identities?.length === 0) {
    return { session: null, isAdmin: false, error: { message: 'already_registered' } }
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
