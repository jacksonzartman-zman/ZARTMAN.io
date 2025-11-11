"use client"
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Export a ready-to-use browser Supabase client instance expected by UI components
export const supabase = createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
})
