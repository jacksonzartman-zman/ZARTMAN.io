import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set to enable auth.",
  );
}

const SUPABASE_URL_VALUE = SUPABASE_URL;
const SUPABASE_ANON_VALUE = SUPABASE_ANON_KEY;

export function createAuthClient(): SupabaseClient {
  return createServerClient(SUPABASE_URL_VALUE, SUPABASE_ANON_VALUE, {
    cookies: {
      async getAll() {
        const cookieStore = await cookies();
        return cookieStore
          .getAll()
          .map((cookie) => ({ name: cookie.name, value: cookie.value }));
      },
      async setAll(cookiesToSet) {
        const cookieStore = await cookies();
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set({ name, value, ...(options ?? {}) });
        });
      },
    },
  }) as unknown as SupabaseClient;
}

export async function getCurrentSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  console.log(
    "[auth] cookies seen by server:",
    cookieStore.getAll?.() ?? "no cookies helper",
  );
  const supabase = createAuthClient();
  const { data, error } = await supabase.auth.getSession();
  console.log("[auth] getSession result:", {
    hasSession: Boolean(data.session),
    email: data.session?.user?.email ?? null,
    error: error?.message ?? null,
  });

  if (error) {
    console.error("getCurrentSession: failed to load session", error);
    return null;
  }

  return data.session ?? null;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function requireSession(options?: {
  redirectTo?: string;
  message?: string;
}): Promise<Session> {
  const session = await getCurrentSession();
  if (session) {
    return session;
  }

  if (options?.redirectTo) {
    redirect(options.redirectTo);
  }

  throw new UnauthorizedError(options?.message);
}

export async function requireUser(options?: { redirectTo?: string }) {
  const session = await requireSession(options);
  return session.user;
}
