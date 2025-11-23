import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";

const DEFAULT_REDIRECT = "/supplier";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next");
  const redirectPath = getSafeRedirectPath(nextParam);

  if (!code) {
    console.warn("Auth callback invoked without a Supabase code");
    return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
  }

  const supabase = createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Auth callback: failed to exchange code", error);
  }

  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}

function getSafeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_REDIRECT;
  }

  if (value === "/auth/callback" || value.startsWith("/auth/callback?")) {
    return DEFAULT_REDIRECT;
  }

  return value;
}
