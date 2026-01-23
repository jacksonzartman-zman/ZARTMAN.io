import "server-only";

import { createClient } from "@supabase/supabase-js";

// Defensive runtime guard: if this ever makes it into a client bundle, fail loudly.
// (Next.js should also prevent this via `server-only`, but this error is clearer.)
if (typeof window !== "undefined") {
  throw new Error("supabase admin client imported into client bundle");
}

type AnySupabaseClient = ReturnType<typeof createClient>;

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
export const supabasePublic = () => {
  const URL = requireSupabaseUrl();
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!ANON) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
  }

  return createClient(URL, ANON, {
    auth: { persistSession: false },
  });
};

// Admin / server client – uses the service role key (server-only)
export const supabaseAdmin = () => {
  const URL = requireSupabaseUrl();
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  return createClient(URL, SERVICE, {
    auth: { persistSession: false },
  });
};

let _adminSingleton: AnySupabaseClient | null = null;
function getAdminSingleton(): AnySupabaseClient {
  _adminSingleton ??= supabaseAdmin();
  return _adminSingleton;
}

// Convenience instance for places that just import `supabaseServer`.
// Lazy to avoid throwing on import during build tooling / static analysis.
export const supabaseServer: AnySupabaseClient = new Proxy(
  {} as AnySupabaseClient,
  {
    get(_target, prop, _receiver) {
      const client = getAdminSingleton() as any;
      const value = client[prop];
      if (typeof value === "function") return value.bind(client);
      return value;
    },
  },
) as AnySupabaseClient;