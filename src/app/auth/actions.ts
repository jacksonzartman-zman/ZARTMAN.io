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
  const origin = getSiteOrigin();
  const emailRedirectTo = `${origin}/auth/callback`;

  try {
    await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo,
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
      requestedNextPath: input.nextPath,
      emailRedirectTo,
      error,
    });
    return {
      success: false,
      error: MAGIC_LINK_ERROR_MESSAGE,
    };
  }
}

function getSiteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured && configured.startsWith("http")) {
    return configured.replace(/\/+$/, "");
  }

  return "https://www.zartman.io";
}
