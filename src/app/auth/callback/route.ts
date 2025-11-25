import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";

const LOGIN_REDIRECT_PATH = "/login";

/**
 * Supabase magic links now point to /login via SITE_URL, so this callback only
 * exchanges the code for a session cookie and hands control back to /login for
 * role-based routing.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  console.log("[auth/callback] received code:", Boolean(code));
  const cookieStoreBefore = await cookies();
  console.log(
    "[auth/callback] cookies BEFORE exchange:",
    cookieStoreBefore.getAll?.() ?? "unavailable",
  );

  if (!code) {
    console.warn("Auth callback invoked without a Supabase code");
    return NextResponse.redirect(new URL(LOGIN_REDIRECT_PATH, requestUrl.origin));
  }

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
    return NextResponse.redirect(new URL(LOGIN_REDIRECT_PATH, requestUrl.origin));
  }

  return NextResponse.redirect(new URL(LOGIN_REDIRECT_PATH, requestUrl.origin));
}
