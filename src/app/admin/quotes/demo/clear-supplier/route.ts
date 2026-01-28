import { NextResponse } from "next/server";

import { requireAdminUser } from "@/server/auth";
import { isDemoModeEnabled } from "@/server/demo/demoMode";
import {
  DEMO_SUPPLIER_PROVIDER_COOKIE_NAME,
} from "@/server/demo/demoSupplierProvider";

function normalizeQuoteId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Only allow redirecting back into the admin quotes list (same-origin enforced below).
  if (!trimmed.startsWith("/admin/quotes")) return null;
  return trimmed;
}

function shouldUseSecureCookie(): boolean {
  const vercelEnv = (process.env.VERCEL_ENV ?? "").trim();
  if (vercelEnv) return true;
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

export async function GET(req: Request) {
  // Defense-in-depth: even if a misconfiguration enables DEMO_MODE, never expose this in production.
  if ((process.env.VERCEL_ENV ?? "").trim().toLowerCase() === "production") {
    return new Response("Not found", { status: 404 });
  }

  if (!isDemoModeEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  await requireAdminUser();

  const url = new URL(req.url);
  const quoteId = normalizeQuoteId(url.searchParams.get("quoteId"));
  const returnTo = normalizeReturnTo(url.searchParams.get("returnTo"));
  const redirectTo = returnTo ?? "/admin/quotes";

  const res = NextResponse.redirect(new URL(redirectTo, url.origin));
  res.cookies.set({
    name: DEMO_SUPPLIER_PROVIDER_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: 0,
  });
  return res;
}

