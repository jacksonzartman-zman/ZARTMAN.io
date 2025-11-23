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

type CookieOptions = {
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none";
  maxAge?: number;
};

function createAuthClient(): SupabaseClient {
  const cookieStore = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options?: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...(options ?? {}) });
        } catch {
          // Set is only allowed inside route handlers and server actions.
        }
      },
      remove(name: string, options?: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...(options ?? {}) });
        } catch {
          // Removal is only allowed inside route handlers and server actions.
        }
      },
    },
  });
}

export async function getCurrentSession(): Promise<Session | null> {
  const supabase = createAuthClient();
  const { data, error } = await supabase.auth.getSession();

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
