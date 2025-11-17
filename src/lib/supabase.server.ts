import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY // only on the server

// Public client (safe for reading where RLS allows it)
export const supabasePublic = () =>
  createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { fetch: fetch as any },
  })

export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// Convenient pre-created server client (null if service role not provided)
export const supabaseSrv = (() => {
  if (!SERVICE) return null as any
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetch as any },
  })
})()
