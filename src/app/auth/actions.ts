"use server";

import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { supabasePublic } from "@/lib/supabaseServer";
import type { PortalRole } from "@/types/portal";

export type RequestMagicLinkInput = {
  role: PortalRole;
  email: string;
  nextPath?: string | null;
};

export type RequestMagicLinkResult = {
  success: boolean;
  normalizedEmail?: string;
  error?: string;
};

const MAGIC_LINK_ERROR_MESSAGE =
  "We couldn’t send a magic link right now. Please try again.";

export async function requestMagicLinkForEmail(
  input: RequestMagicLinkInput,
): Promise<RequestMagicLinkResult> {
  const normalizedEmail = normalizeEmailInput(input.email);
  if (!normalizedEmail) {
    return {
      success: false,
      error:
        input.role === "supplier"
          ? "Enter a business email that matches your onboarding profile."
          : "Enter a valid work email address.",
    };
  }

  const supabase = supabasePublic();
  const safeNextPath = getSafeNextPath(input.nextPath);
  const origin = resolveSiteOrigin();

  try {
    await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
          safeNextPath,
        )}`,
      },
    });
    return {
      success: true,
      normalizedEmail,
    };
  } catch (error) {
    console.error("requestMagicLinkForEmail: failed to send OTP", {
      role: input.role,
      email: normalizedEmail,
      nextPath: safeNextPath,
      error,
    });
    return {
      success: false,
      error: MAGIC_LINK_ERROR_MESSAGE,
    };
  }
}

function getSafeNextPath(value: string | null | undefined): string {
  const fallback = "/login";
  if (!value || typeof value !== "string") {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  if (value.startsWith("/auth/")) {
    return fallback;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(value)) {
    return fallback;
  }

  return value;
}

function resolveSiteOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  if (process.env.SITE_URL) {
    return process.env.SITE_URL;
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  return "http://localhost:3000";
}
