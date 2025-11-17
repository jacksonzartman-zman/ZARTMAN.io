// Simple supabase helper using `@supabase/supabase-js` only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const _hasValidUrl = (u?: string) => !!u && /^https?:\/\//i.test(u)

// Browser client (for client components) — created lazily so builds
// and unit tests without env vars won't crash.
export function sbBrowser(): SupabaseClient | null {
  if (!_hasValidUrl(URL) || !ANON) return null
  return createClient(URL as string, ANON as string)
}

// Server client (route handlers use service role when available)
export function sbService(): SupabaseClient | null {
  if (!_hasValidUrl(URL)) return null
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  // fall back to anon on dev if needed
  return createClient(URL as string, (srv || ANON || '') as string, {
    auth: { persistSession: false },
    global: { fetch: fetch as any }
  })
}

export function supabase(): SupabaseClient | null {
  if (!_hasValidUrl(URL) || !ANON) return null
  return createClient(URL as string, ANON as string, { realtime: { params: { eventsPerSecond: 5 } } })
}
