import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Eager browser client instance (keeps previous code working that expects `supabase`)
export const supabase = createClient(url, anon, { auth: { persistSession: true } })

// Factory for callers that prefer to call a function
export const supabaseBrowser = () => supabase

