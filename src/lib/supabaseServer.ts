import { createClient } from "@supabase/supabase-js";

const URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL) {
  throw new Error(
    "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required (check your env vars)."
  );
}

// Public client – safe for RLS-protected reads, used in some routes
export const supabasePublic = () => {
  if (!ANON) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
  }

  return createClient(URL, ANON, {
    auth: { persistSession: false },
  });
};

// Admin / server client – uses the service role key (server-only)
export const supabaseAdmin = () => {
  if (!SERVICE) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  return createClient(URL, SERVICE, {
    auth: { persistSession: false },
  });
};

// Convenience instance for places that just import `supabaseServer`
export const supabaseServer = supabaseAdmin();