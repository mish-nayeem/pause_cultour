import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Loud warning during dev instead of a silent failure at checkout time.
  console.warn(
    '[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. ' +
    'Copy .env.example to .env and fill in your project values.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
