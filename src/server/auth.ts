import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { extractSupabaseSource, serializeSupabaseError } from "@/server/admin/logging";
import { debugOnce } from "@/server/db/schemaErrors";

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
  hasUser: boolean;
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

type SupabaseAuthUserResult = {
  data: { user: User | null } | null;
  error: unknown | null;
  missingSession: boolean;
};

const AUTH_SESSION_MISSING_LOG_KEY = "auth:session_missing";

function readStringProp(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  return key in obj && typeof (obj as { [key: string]: unknown })[key] === "string"
    ? ((obj as { [key: string]: unknown })[key] as string)
    : null;
}

function readNumberProp(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  return key in obj && typeof (obj as { [key: string]: unknown })[key] === "number"
    ? ((obj as { [key: string]: unknown })[key] as number)
    : null;
}

function readBooleanProp(obj: unknown, key: string): boolean | null {
  if (!obj || typeof obj !== "object") return null;
  return key in obj && typeof (obj as { [key: string]: unknown })[key] === "boolean"
    ? ((obj as { [key: string]: unknown })[key] as boolean)
    : null;
}

function isAuthSessionMissingError(error: unknown): boolean {
  if (!error) return false;
  const source = extractSupabaseSource(error);
  const serialized = serializeSupabaseError(error);
  const message =
    readStringProp(source, "message") ??
    readStringProp(error, "message") ??
    serialized.message ??
    (error instanceof Error ? error.message : null);
  if (message && message.toLowerCase().includes("auth session missing")) {
    return true;
  }

  const name =
    readStringProp(source, "name") ??
    readStringProp(error, "name") ??
    (error instanceof Error ? error.name : null);
  if (name === "AuthSessionMissingError") {
    return true;
  }

  const isAuthError =
    readBooleanProp(source, "__isAuthError") ?? readBooleanProp(error, "__isAuthError");
  const status =
    readNumberProp(source, "status") ??
    readNumberProp(source, "statusCode") ??
    readNumberProp(error, "status") ??
    readNumberProp(error, "statusCode");
  return Boolean(isAuthError && status === 400);
}

function logMissingAuthSessionOnce(error: unknown) {
  const source = extractSupabaseSource(error);
  const serialized = serializeSupabaseError(error);
  debugOnce(
    AUTH_SESSION_MISSING_LOG_KEY,
    "[auth] missing session; treating as anonymous",
    {
      message: serialized.message,
      name: readStringProp(source, "name") ?? readStringProp(error, "name"),
      status:
        readNumberProp(source, "status") ??
        readNumberProp(source, "statusCode") ??
        readNumberProp(error, "status") ??
        readNumberProp(error, "statusCode"),
    },
  );
}

type GetServerAuthUserOptions = {
  quiet?: boolean;
};

async function getSupabaseAuthUser(
  supabase: SupabaseClientType,
  options?: GetServerAuthUserOptions,
): Promise<SupabaseAuthUserResult> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && isAuthSessionMissingError(error)) {
      if (!options?.quiet) {
        logMissingAuthSessionOnce(error);
      }
      return { data: { user: null }, error: null, missingSession: true };
    }
    return { data: data ?? null, error: error ?? null, missingSession: false };
  } catch (error) {
    if (isAuthSessionMissingError(error)) {
      if (!options?.quiet) {
        logMissingAuthSessionOnce(error);
      }
      return { data: { user: null }, error: null, missingSession: true };
    }
    throw error;
  }
}

// Example (anonymous request, no cookies):
// const { user, error, hasUser } = await getServerAuthUser();
// -> user === null, error === null, hasUser === false (no error logs)
export async function getServerAuthUser(
  options?: GetServerAuthUserOptions,
): Promise<ServerAuthUserResult> {
  try {
    const supabase = await createReadOnlyAuthClient();
    const { data, error, missingSession } = await getSupabaseAuthUser(supabase, options);
    const hasUser = Boolean(data?.user);
    const serializedError = error ? serializeSupabaseError(error) : null;

    if (!options?.quiet) {
      console.info("[auth] getUser result:", {
        hasUser,
        error: serializedError,
      });
    }

    if (missingSession) {
      return { user: null, error: null, hasUser: false };
    }

    if (error) {
      if (isDynamicServerUsageError(error)) {
        if (!options?.quiet) {
          console.info(
            "[auth] getUser run skipped during static generation (dynamic route only)",
          );
        }
        return { user: null, error: serializedError ?? error, hasUser: false };
      }

      if (!options?.quiet) {
        console.error("[auth] getUser failed", error);
      }
      return { user: null, error: serializedError ?? error, hasUser: false };
    }

    if (!data?.user) {
      if (!options?.quiet) {
        console.warn("[auth] no authenticated user returned by Supabase");
      }
      return { user: null, error: null, hasUser: false };
    }

    return {
      user: data.user,
      error: null,
      hasUser: true,
    };
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      if (!options?.quiet) {
        console.info(
          "[auth] getServerAuthUser skipped during static generation (dynamic route only)",
        );
      }
      return { user: null, error, hasUser: false };
    }

    if (isAuthSessionMissingError(error)) {
      if (!options?.quiet) {
        logMissingAuthSessionOnce(error);
      }
      return { user: null, error: null, hasUser: false };
    }

    if (!options?.quiet) {
      console.error("[auth] getServerAuthUser: unexpected failure", error);
    }
    return { user: null, error, hasUser: false };
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

export async function requireAdminUser(
  options?: RequireUserOptions,
): Promise<User> {
  const user = await requireUser(options);

  // Hard gate: admin routes/actions are protected by a server-set httpOnly cookie.
  // This avoids relying on email heuristics and prevents accidental exposure of
  // service-role backed admin data to regular authenticated users.
  const cookieStore = await cookies();
  const isUnlocked = cookieStore.get("zartman_admin")?.value === "1";

  if (!isUnlocked) {
    throw new UnauthorizedError(options?.message ?? "Not authorized.");
  }

  return user;
}
