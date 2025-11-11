// web/src/lib/supabase.ts
import { createBrowserClient } from '@supabase/ssr'
import { createClient as createServerClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Browser client (for client components)
export function sbBrowser(): SupabaseClient {
  return createBrowserClient(URL, ANON)
}

// Server client (route handlers use service role when available)
export function sbService(): SupabaseClient {
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  // fall back to anon on dev if needed
  return createServerClient(URL, srv || ANON, {
    auth: { persistSession: false },
    global: { fetch: fetch as any }
  })
}
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { realtime: { params: { eventsPerSecond: 5 } } }
);
