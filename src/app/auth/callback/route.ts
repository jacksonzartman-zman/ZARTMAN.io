import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";
import { debugOnce, serializeSupabaseError } from "@/server/db/schemaErrors";
import { getRequestOrigin } from "@/server/requestOrigin";

const LOGIN_REDIRECT_PATH = "/login";
const NEXT_QUERY_KEY = "next";

function resolveSafeNextPath(requestUrl: URL): string | null {
  const next = requestUrl.searchParams.get(NEXT_QUERY_KEY);
  if (typeof next !== "string") {
    return null;
  }
  const trimmed = next.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  if (trimmed === "/login" || trimmed.startsWith("/login?")) {
    return null;
  }
  return trimmed;
}

/**
 * This route is the target of Supabase magic link redirects.
 * It exchanges the "code" for a Supabase session and then
 * redirects back to /login, where role-based logic runs.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") ?? "magiclink";
  const nextPath = resolveSafeNextPath(requestUrl);
  const redirectTarget = nextPath ?? LOGIN_REDIRECT_PATH;
  const origin = getRequestOrigin(request.headers);

  debugOnce("auth:callback:incoming", "[auth/callback] incoming auth redirect", {
    origin,
    redirectTo: requestUrl.origin ? `${requestUrl.origin}/auth/callback` : null,
    next: nextPath,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
    hasCode: Boolean(code),
    hasTokenHash: Boolean(tokenHash),
    type,
  });

  if (!code && !tokenHash) {
    debugOnce("auth:callback:missing_token", "[auth/callback] invoked without code/token_hash", {
      origin,
      next: nextPath,
    });
    return NextResponse.redirect(new URL(redirectTarget, requestUrl.origin));
  }

  const supabase = createAuthClient();
  let exchangeError: unknown | null = null;
  let hasSession = false;
  let hasUser = false;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeError = error ?? null;
    hasSession = Boolean(data?.session);
    hasUser = Boolean(data?.user);
  } else if (tokenHash) {
    // Back-compat: older flows may redirect with token_hash + type.
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as any,
    });
    exchangeError = error ?? null;
    hasSession = Boolean((data as any)?.session);
    hasUser = Boolean((data as any)?.user);
  }

  const serializedError = exchangeError ? serializeSupabaseError(exchangeError) : null;
  debugOnce("auth:callback:exchange_result", "[auth/callback] exchange result", {
    origin,
    next: nextPath,
    hasSession,
    hasUser,
    error: serializedError,
  });

  return NextResponse.redirect(new URL(redirectTarget, requestUrl.origin));
}
