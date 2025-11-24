import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthClient } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierByUserId } from "@/server/suppliers";

const DEFAULT_REDIRECT = "/supplier";
const CUSTOMER_PORTAL_PATH = "/customer";
const SUPPLIER_PORTAL_PATH = "/supplier";
const LOGIN_HUB_PATH = "/login";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next");
  const safeRedirect = getSafeRedirectPath(nextParam);
  const hasValidNext = Boolean(nextParam && safeRedirect === nextParam);

  if (!code) {
    console.warn("Auth callback invoked without a Supabase code");
    return NextResponse.redirect(new URL(safeRedirect, requestUrl.origin));
  }

  const supabase = createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Auth callback: failed to exchange code", error);
    return NextResponse.redirect(new URL(safeRedirect, requestUrl.origin));
  }

  if (hasValidNext) {
    return NextResponse.redirect(new URL(safeRedirect, requestUrl.origin));
  }

  const inferredPath = await inferRedirectPath({
    supabase,
    fallback: safeRedirect,
  });

  return NextResponse.redirect(new URL(inferredPath, requestUrl.origin));
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

function isSafeInternalPath(path: string | null): path is string {
  return Boolean(path && getSafeRedirectPath(path) === path);
}

async function inferRedirectPath({
  supabase,
  fallback,
}: {
  supabase: SupabaseClient;
  fallback: string;
}): Promise<string> {
  const safeFallback = isSafeInternalPath(fallback) ? fallback : LOGIN_HUB_PATH;

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      console.error("inferRedirectPath: failed to load user", error);
      return safeFallback;
    }

    const userId = data.user?.id;
    if (!userId) {
      return safeFallback;
    }

    const [customer, supplier] = await Promise.all([
      getCustomerByUserId(userId),
      loadSupplierByUserId(userId),
    ]);

    if (customer && supplier) {
      return LOGIN_HUB_PATH; // Dual-role accounts pick their portal from the login hub.
    }

    if (customer) {
      return CUSTOMER_PORTAL_PATH;
    }

    if (supplier) {
      return SUPPLIER_PORTAL_PATH;
    }

    return LOGIN_HUB_PATH;
  } catch (error) {
    console.error("inferRedirectPath: unexpected failure", error);
    return safeFallback;
  }
}
