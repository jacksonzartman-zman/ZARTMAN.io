import { NextResponse } from "next/server";

import { requireAdminUser } from "@/server/auth";
import { isDemoModeEnabled } from "@/server/demo/demoMode";
import {
  DEMO_SUPPLIER_PROVIDER_COOKIE_NAME,
} from "@/server/demo/demoSupplierProvider";

function normalizeProviderId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuoteId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function shouldUseSecureCookie(): boolean {
  // On Vercel Preview, NODE_ENV is "production" but HTTPS is still used.
  const vercelEnv = (process.env.VERCEL_ENV ?? "").trim();
  if (vercelEnv) return true;
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

export async function GET(req: Request) {
  // Security: demo cookie mapping is never available in production.
  if (!isDemoModeEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  await requireAdminUser();

  const url = new URL(req.url);
  const providerId = normalizeProviderId(url.searchParams.get("providerId"));
  const quoteId = normalizeQuoteId(url.searchParams.get("quoteId"));

  if (!providerId) {
    return new Response("Missing providerId", { status: 400 });
  }

  const redirectTo = quoteId ? `/supplier/quotes/${encodeURIComponent(quoteId)}` : "/supplier/quotes";

  const res = NextResponse.redirect(new URL(redirectTo, url.origin));
  res.cookies.set({
    name: DEMO_SUPPLIER_PROVIDER_COOKIE_NAME,
    value: providerId,
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}

