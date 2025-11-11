// Simple supabase helper using `@supabase/supabase-js` only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Browser client (for client components) — created lazily so builds
// and unit tests without env vars won't crash.
export function sbBrowser(): SupabaseClient | null {
  if (!URL || !ANON) return null
  return createClient(URL, ANON)
}

// Server client (route handlers use service role when available)
export function sbService(): SupabaseClient | null {
  if (!URL) return null
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  // fall back to anon on dev if needed
  return createClient(URL, srv || ANON || '', {
    auth: { persistSession: false },
    global: { fetch: fetch as any }
  })
}

export function supabase(): SupabaseClient | null {
  if (!URL || !ANON) return null
  return createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 5 } } })
}
