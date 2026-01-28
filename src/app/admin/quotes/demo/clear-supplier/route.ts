import { NextResponse } from "next/server";

import { requireAdminUser } from "@/server/auth";
import { isDemoModeEnabled } from "@/server/demo/demoMode";
import {
  DEMO_SUPPLIER_PROVIDER_COOKIE_NAME,
} from "@/server/demo/demoSupplierProvider";

function normalizeQuoteId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function shouldUseSecureCookie(): boolean {
  const vercelEnv = (process.env.VERCEL_ENV ?? "").trim();
  if (vercelEnv) return true;
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

export async function GET(req: Request) {
  if (!isDemoModeEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  await requireAdminUser();

  const url = new URL(req.url);
  const quoteId = normalizeQuoteId(url.searchParams.get("quoteId"));
  const redirectTo = quoteId ? `/supplier/quotes/${encodeURIComponent(quoteId)}` : "/admin/quotes";

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

