import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabaseDatabase";

// Defensive runtime guard: if this ever makes it into a client bundle, fail loudly.
// (Next.js should also prevent this via `server-only`, but this error is clearer.)
if (typeof window !== "undefined") {
  throw new Error("supabase admin client imported into client bundle");
}

function requireSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required (check your env vars).",
    );
  }
  return url;
}

// Public client – safe for RLS-protected reads, used in some routes
export function supabasePublic(): SupabaseClient<Database> {
  const URL = requireSupabaseUrl();
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!ANON) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
  }

  return createClient<Database>(URL, ANON, {
    auth: { persistSession: false },
  });
}

// Admin / server client – uses the service role key (server-only)
let _adminSingleton: SupabaseClient<Database> | null = null;

export function supabaseAdmin(): SupabaseClient<Database> {
  // Lazy init so importing this module doesn't require env vars during build tooling.
  if (_adminSingleton) return _adminSingleton;

  const URL = requireSupabaseUrl();
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  _adminSingleton = createClient<Database>(URL, SERVICE, {
    auth: { persistSession: false },
  });
  return _adminSingleton;
}

// Back-compat export name:
// - preferred: `supabaseServer().from(...)`
// - legacy: `supabaseServer.from(...)` (supported to reduce churn)
type SupabaseServerCompat = (() => SupabaseClient<Database>) &
  Pick<SupabaseClient<Database>, "from" | "rpc"> & {
    auth: SupabaseClient<Database>["auth"];
    storage: SupabaseClient<Database>["storage"];
    functions: SupabaseClient<Database>["functions"];
  };

export const supabaseServer: SupabaseServerCompat = Object.assign(
  (() => supabaseAdmin()) as unknown as SupabaseServerCompat,
  {
    from: ((...args: any[]) => (supabaseAdmin() as any).from(...args)) as SupabaseClient<Database>["from"],
    rpc: ((...args: any[]) => (supabaseAdmin() as any).rpc(...args)) as SupabaseClient<Database>["rpc"],
  },
);

Object.defineProperties(supabaseServer, {
  auth: {
    get() {
      return supabaseAdmin().auth;
    },
  },
  storage: {
    get() {
      return supabaseAdmin().storage;
    },
  },
  functions: {
    get() {
      return supabaseAdmin().functions;
    },
  },
});