import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set to enable auth.",
  );
}

const SUPABASE_URL_VALUE = SUPABASE_URL;
const SUPABASE_ANON_KEY_VALUE = SUPABASE_ANON_KEY;

function createServerSupabaseClient() {
  const getCookieStore = async () =>
    (await cookies()) as unknown as {
      get(name: string): { value: string } | undefined;
      set(options: { name: string; value: string } & CookieOptions): void;
    };

  return createServerClient(SUPABASE_URL_VALUE, SUPABASE_ANON_KEY_VALUE, {
    cookies: {
      async get(name: string) {
        const cookieStore = await getCookieStore();
        return cookieStore.get(name)?.value;
      },
      async set(name: string, value: string, options: CookieOptions) {
        const cookieStore = await getCookieStore();
        cookieStore.set({ name, value, ...options });
      },
      async remove(name: string, options: CookieOptions) {
        const cookieStore = await getCookieStore();
        cookieStore.set({
          name,
          value: "",
          ...options,
          maxAge: 0,
        });
      },
    },
  });
}

type SupabaseClientType = ReturnType<typeof createServerSupabaseClient>;

export function createAuthClient() {
  return createServerSupabaseClient();
}

export function createReadOnlyAuthClient(): SupabaseClientType {
  const getCookieStore = async () => await cookies();

  return createServerClient(SUPABASE_URL_VALUE, SUPABASE_ANON_KEY_VALUE, {
    cookies: {
      async get(name: string) {
        const cookieStore = await getCookieStore();
        return cookieStore.get(name)?.value;
      },
      async set(
        _name: string,
        _value: string,
        _options: CookieOptions,
      ) {
        // no-op: read-only in server components
      },
      async remove(
        _name: string,
        _options: CookieOptions,
      ) {
        // no-op: read-only in server components
      },
    },
  });
}

export async function getCurrentSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const cookieNames =
    typeof cookieStore.getAll === "function"
      ? cookieStore.getAll().map((entry) => entry.name)
      : [];
  console.log("[auth] cookies seen by server:", cookieNames);

  const supabase = createReadOnlyAuthClient();
  const { data, error } = await supabase.auth.getSession();

  console.log("[auth] getSession result:", {
    hasSession: Boolean(data.session),
    email: data.session?.user?.email ?? null,
    error: error?.message ?? null,
  });

  if (error) {
    console.error("[auth] getSession failed", error);
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
