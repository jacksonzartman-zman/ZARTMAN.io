import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";

const LOGIN_REDIRECT_PATH = "/login";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const rawNext = requestUrl.searchParams.get("next");
  const decodedNext = safelyDecodeURIComponent(rawNext);

  console.log("[auth/callback] next param (raw):", rawNext);
  console.log("[auth/callback] next param (decoded):", decodedNext);
  if (!code) {
    console.warn("Auth callback invoked without a Supabase code");
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

  const redirectPath =
    typeof decodedNext === "string" && isSafeInternalPath(decodedNext)
      ? decodedNext
      : LOGIN_REDIRECT_PATH;

  console.log("[auth/callback] redirecting to:", redirectPath);

  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}

function safelyDecodeURIComponent(value: string | null): string | null {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch (error) {
    console.warn("[auth/callback] failed to decode next param, using raw value", {
      value,
      error,
    });
    return value;
  }
}

function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith("/")) {
    return false;
  }

  if (path.startsWith("//")) {
    return false;
  }

  if (path.startsWith("/auth/")) {
    return false;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(path)) {
    return false;
  }

  return true;
}
