import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";

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
  const nextPath = resolveSafeNextPath(requestUrl);
  const redirectTarget = nextPath
    ? `${LOGIN_REDIRECT_PATH}?next=${encodeURIComponent(nextPath)}`
    : LOGIN_REDIRECT_PATH;

  console.log("[auth/callback] incoming url", request.url);
  console.log("[auth/callback] code present", Boolean(code));

  if (!code) {
    console.warn("[auth/callback] invoked without code");
    return NextResponse.redirect(new URL(redirectTarget, requestUrl.origin));
  }

  const cookieStoreBefore = await cookies();
  console.log(
    "[auth/callback] cookies BEFORE exchange:",
    cookieStoreBefore.getAll?.() ?? "unavailable",
  );

  const supabase = createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  console.log("[auth/callback] exchange error:", error?.message ?? null);

  const cookieStoreAfter = await cookies();
  console.log(
    "[auth/callback] cookies AFTER exchange:",
    cookieStoreAfter.getAll?.() ?? "unavailable",
  );

  if (error) {
    console.error("[auth/callback] failed to exchange code", {
      code,
      message: error.message,
      stack: error.stack,
    });
    return NextResponse.redirect(new URL(redirectTarget, requestUrl.origin));
  }

  return NextResponse.redirect(new URL(redirectTarget, requestUrl.origin));
}
