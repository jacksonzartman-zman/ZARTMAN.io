import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { serializeSupabaseError } from "@/server/admin/logging";

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

export type ServerAuthUserResult = {
  user: User | null;
  error: unknown | null;
};

type RequireUserOptions = {
  redirectTo?: string;
  message?: string;
};

export function createAuthClient() {
  return createServerSupabaseClient();
}

export async function createReadOnlyAuthClient(): Promise<SupabaseClientType> {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL_VALUE, SUPABASE_ANON_KEY_VALUE, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {
        // no-op: read-only in server components
      },
      remove() {
        // no-op: read-only in server components
      },
    },
  });
}

const DYNAMIC_SERVER_USAGE_DIGEST = "DYNAMIC_SERVER_USAGE";

function isDynamicServerUsageError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const hasDigest = (candidate: unknown): boolean => {
    if (!candidate) {
      return false;
    }

    if (typeof candidate === "string") {
      return candidate.startsWith(DYNAMIC_SERVER_USAGE_DIGEST);
    }

    if (typeof candidate === "object") {
      const digest = (candidate as { digest?: unknown }).digest;
      if (typeof digest === "string" && digest.startsWith(DYNAMIC_SERVER_USAGE_DIGEST)) {
        return true;
      }

      const cause = (candidate as { cause?: unknown }).cause;
      if (cause && hasDigest(cause)) {
        return true;
      }
    }

    return false;
  };

  return hasDigest(error) || (error instanceof Error && hasDigest(error.message));
}

export async function getServerAuthUser(): Promise<ServerAuthUserResult> {
  try {
    const cookieStore = await cookies();
    const cookieNames =
      typeof cookieStore.getAll === "function"
        ? cookieStore.getAll().map((entry) => entry.name)
        : [];
    console.log("[auth] cookies seen by server:", cookieNames);

    const supabase = await createReadOnlyAuthClient();
    const { data, error } = await supabase.auth.getUser();
    const serializedError = error ? serializeSupabaseError(error) : null;

    console.info("[auth] getUser result:", {
      hasUser: Boolean(data?.user),
      email: data?.user?.email ?? null,
      error: serializedError,
    });

    if (error) {
      if (isDynamicServerUsageError(error)) {
        console.info(
          "[auth] getUser run skipped during static generation (dynamic route only)",
        );
        return { user: null, error: serializedError ?? error };
      }

      console.error("[auth] getUser failed", error);
      return { user: null, error: serializedError ?? error };
    }

    if (!data?.user) {
      console.warn("[auth] no authenticated user returned by Supabase");
      return { user: null, error: null };
    }

    return {
      user: data.user,
      error: null,
    };
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      console.info(
        "[auth] getServerAuthUser skipped during static generation (dynamic route only)",
      );
      return { user: null, error };
    }

    console.error("[auth] getServerAuthUser: unexpected failure", error);
    return { user: null, error };
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function requireUser(options?: RequireUserOptions): Promise<User> {
  const { user, error } = await getServerAuthUser();
  if (user) {
    return user;
  }

  console.error("[auth] requireUser failed", {
    reason: "no-user",
    error,
  });

  if (options?.redirectTo) {
    redirect(options.redirectTo);
  }

  throw new UnauthorizedError(options?.message ?? "You must be signed in.");
}
