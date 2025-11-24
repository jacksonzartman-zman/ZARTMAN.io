import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth";
import { getCustomerByEmail } from "@/server/customers";
import { loadSupplierProfile } from "@/server/suppliers";

const CUSTOMER_REDIRECT = "/customer";
const SUPPLIER_REDIRECT = "/supplier";
const LOGIN_REDIRECT = "/login";
const DEFAULT_REDIRECT = SUPPLIER_REDIRECT;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next");
  let redirectPath = getSafeRedirectPath(nextParam);

  if (!code) {
    console.warn("Auth callback invoked without a Supabase code");
    return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
  }

  const supabase = createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Auth callback: failed to exchange code", error);
    return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
  }

  if (!nextParam) {
    redirectPath = await inferRedirectPath({
      supabase,
      fallback: redirectPath,
    });
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

async function inferRedirectPath({
  supabase,
  fallback,
}: {
  supabase: ReturnType<typeof createAuthClient>;
  fallback: string;
}): Promise<string> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("Auth callback: failed to load user after session exchange", {
        error,
      });
      return fallback;
    }

    const email = data?.user?.email;
    if (!email) {
      return fallback;
    }

    const [customer, supplierProfile] = await Promise.all([
      getCustomerByEmail(email),
      loadSupplierProfile(email),
    ]);

    if (customer) {
      return CUSTOMER_REDIRECT;
    }

    if (supplierProfile) {
      return SUPPLIER_REDIRECT;
    }

    return LOGIN_REDIRECT;
  } catch (error) {
    console.error("Auth callback: failed to infer redirect", error);
    return fallback;
  }
}
