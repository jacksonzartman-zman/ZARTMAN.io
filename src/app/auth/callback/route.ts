import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";

const LOGIN_REDIRECT = "/login";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next");
  if (!code) {
    console.warn("Auth callback invoked without a Supabase code");
    return NextResponse.redirect(new URL(LOGIN_REDIRECT, requestUrl.origin));
  }

  const supabase = createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Auth callback: failed to exchange code", {
      code,
      message: error.message,
    });
    return NextResponse.redirect(new URL(LOGIN_REDIRECT, requestUrl.origin));
  }

  const redirectPath =
    typeof nextParam === "string" && isSafeInternalPath(nextParam)
      ? nextParam
      : LOGIN_REDIRECT;

  console.log("Auth callback redirect", {
    next: nextParam,
    redirectPath,
  });
  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}

function isSafeInternalPath(path: string): boolean {
  if (typeof path !== "string") {
    return false;
  }
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) {
    return false;
  }
  if (trimmed.startsWith("//")) {
    return false;
  }
  if (trimmed === "/auth" || trimmed.startsWith("/auth/")) {
    return false;
  }
  return true;
}
