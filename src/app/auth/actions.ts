"use server";

import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { supabasePublic } from "@/lib/supabaseServer";
import { debugOnce } from "@/server/db/schemaErrors";
import { buildAuthCallbackRedirectTo, getRequestOrigin } from "@/server/requestOrigin";
import type { PortalRole } from "@/types/portal";
import { headers } from "next/headers";

export type RequestMagicLinkInput = {
  role: PortalRole;
  email: string;
  nextPath?: string | null;
  clientOrigin?: string;
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
  const headerList = await headers();
  const origin = getRequestOrigin(headerList, { clientOrigin: input.clientOrigin });
  const { redirectTo: emailRedirectTo, next: nextPath } = buildAuthCallbackRedirectTo({
    origin,
    nextPath: input.nextPath,
  });

  debugOnce(`auth:magiclink:send:${input.role}`, "[auth] sending magic link", {
    origin,
    redirectTo: emailRedirectTo,
    next: nextPath,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
  });

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
      origin,
      nextPath,
      emailRedirectTo,
      error,
    });
    return {
      success: false,
      error: MAGIC_LINK_ERROR_MESSAGE,
    };
  }
}

