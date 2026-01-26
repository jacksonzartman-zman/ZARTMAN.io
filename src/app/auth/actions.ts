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
  /**
   * Non-production only: returned to the client for debugging.
   * Never includes tokens/codes/cookies.
   */
  ok?: true;
  /**
   * Non-production only: the callback URL used for the magic link.
   */
  emailRedirectTo?: string;
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
  const { redirectTo: emailRedirectTo, next } = buildAuthCallbackRedirectTo({
    origin,
    nextPath: input.nextPath,
  });

  const vercelEnv = process.env.VERCEL_ENV ?? null;
  const nodeEnv = process.env.NODE_ENV ?? null;
  const isProduction = vercelEnv === "production" || nodeEnv === "production";

  // Server-only structured debug log. Do not include tokens/codes/cookies.
  console.log({
    clientOrigin: input.clientOrigin ?? null,
    resolvedOrigin: origin,
    emailRedirectTo,
    next,
    vercelEnv,
    nodeEnv,
  });

  debugOnce(`auth:magiclink:send:${input.role}`, "[auth] sending magic link", {
    origin,
    emailRedirectTo,
    next,
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
    if (isProduction) {
      return {
        success: true,
        normalizedEmail,
      };
    }
    return {
      success: true,
      normalizedEmail,
      ok: true,
      emailRedirectTo,
    };
  } catch (error) {
    console.error("requestMagicLinkForEmail: failed to send OTP", {
      role: input.role,
      origin,
      next,
      emailRedirectTo,
      error,
    });
    return {
      success: false,
      error: MAGIC_LINK_ERROR_MESSAGE,
    };
  }
}

