import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";

const LOGIN_REDIRECT_PATH = "/login";

/**
 * This route is the target of Supabase magic link redirects.
 * It exchanges the "code" for a Supabase session and then
 * redirects back to /login, where role-based logic runs.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    console.warn("[auth/callback] invoked without code");
    return NextResponse.redirect(new URL(LOGIN_REDIRECT_PATH, requestUrl.origin));
  }

  const supabase = createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

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
