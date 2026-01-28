"use server";

import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { supabasePublic } from "@/lib/supabaseServer";
import { debugOnce } from "@/server/db/schemaErrors";
import { buildAuthCallbackRedirectTo, getRequestOrigin } from "@/server/requestOrigin";
import { checkOtpThrottle, markOtpAttempt } from "@/server/auth/otpThrottle";
import type { PortalRole } from "@/types/portal";
import { randomUUID } from "crypto";
import { headers } from "next/headers";

export type RequestMagicLinkInput = {
  role: PortalRole;
  email: string;
  nextPath?: string | null;
  clientOrigin?: string;
};

export type RequestMagicLinkResult = {
  ok: true;
  requestId: string;
  retryAfterSeconds: number;
} | {
  ok: false;
  requestId: string;
  error: string;
  retryAfterSeconds: number;
  /**
   * Non-production only: returned to the client for debugging.
   * Never includes tokens/codes/cookies.
   */
  debug?: {
    supabaseMessage: string | null;
    status: number | null;
  };
};

const MAGIC_LINK_ERROR_MESSAGE = "We couldn’t send a magic link right now. Please try again.";
const OTP_COOLDOWN_SECONDS = 60;

function maskEmailForLogs(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 1) return "[redacted-email]";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const prefix = local[0] ?? "x";
  const domainRoot = domain.split(".")[0] ?? "domain";
  return `${prefix}***@${domainRoot}.***`;
}

function resolveClientIp(headerList: Awaited<ReturnType<typeof headers>>): string | null {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headerList.get("x-real-ip")?.trim();
  return realIp && realIp.length > 0 ? realIp : null;
}

function classifySupabaseOtpError(message: string): {
  error: string;
  retryAfterSeconds: number;
} {
  const haystack = message.toLowerCase();

  if (
    haystack.includes("rate limit") ||
    haystack.includes("for security purposes")
  ) {
    return {
      error: "Supabase rate-limited the request. Wait 60 seconds and try again.",
      retryAfterSeconds: OTP_COOLDOWN_SECONDS,
    };
  }

  if (
    haystack.includes("redirect") ||
    haystack.includes("not allowed") ||
    haystack.includes("not allowlisted") ||
    haystack.includes("not whitelisted")
  ) {
    return {
      error: "Supabase rejected the redirect URL. The preview domain must be allowlisted.",
      retryAfterSeconds: 0,
    };
  }

  if (haystack.includes("provider") && haystack.includes("disabled")) {
    return {
      error: "Supabase email provider is disabled for this project.",
      retryAfterSeconds: 0,
    };
  }

  return { error: MAGIC_LINK_ERROR_MESSAGE, retryAfterSeconds: 0 };
}

export async function requestMagicLinkForEmail(
  input: RequestMagicLinkInput,
): Promise<RequestMagicLinkResult> {
  // Verification (preview/prod):
  // - Server logs should include:
  //   - "[auth otp] start" with requestId
  //   - and either "[auth otp] success" or "[auth otp] error" with the same requestId
  const requestId = randomUUID();

  const vercelEnv = process.env.VERCEL_ENV ?? null;
  const nodeEnv = process.env.NODE_ENV ?? null;
  const isProduction = vercelEnv === "production" || nodeEnv === "production";

  try {
    const normalizedEmail = normalizeEmailInput(input.email);

    const headerList = await headers();
    const origin = getRequestOrigin(headerList, { clientOrigin: input.clientOrigin });
    const clientIp = resolveClientIp(headerList);
    const { redirectTo: emailRedirectTo, next } = buildAuthCallbackRedirectTo({
      origin,
      nextPath: input.nextPath,
    });

    console.error("[auth otp] start", {
      requestId,
      email: maskEmailForLogs(normalizedEmail ?? input.email),
      next,
      resolvedOrigin: origin,
      emailRedirectTo,
      vercelEnv,
      nodeEnv,
      clientIp,
    });

    if (!normalizedEmail) {
      const error =
        input.role === "supplier"
          ? `Enter a business email that matches your onboarding profile. (Request ID: ${requestId})`
          : `Enter a valid work email address. (Request ID: ${requestId})`;
      console.error("[auth otp] error", {
        requestId,
        code: null,
        message: "invalid email",
        name: "validation_error",
      });
      return { ok: false, requestId, retryAfterSeconds: 0, error };
    }

    const throttle = checkOtpThrottle(normalizedEmail);
    if (!throttle.allowed) {
      console.warn("[auth otp] throttled", {
        requestId,
        email: maskEmailForLogs(normalizedEmail),
        retryAfterSeconds: throttle.retryAfterSeconds,
        clientIp,
      });
      return {
        ok: false,
        requestId,
        retryAfterSeconds: throttle.retryAfterSeconds,
        error: `Please wait ${throttle.retryAfterSeconds} seconds before requesting another link.`,
      };
    }

    // Server-only structured debug log. Do not include tokens/codes/cookies.
    debugOnce(`auth:magiclink:send:${input.role}`, "[auth otp] sending magic link", {
      requestId,
      origin,
      emailRedirectTo,
      next,
      VERCEL_ENV: vercelEnv,
      NODE_ENV: nodeEnv,
    });

    // Mark before calling Supabase to prevent rapid repeat attempts (even if Supabase errors).
    markOtpAttempt(normalizedEmail);

    // Confirmed: magic link login uses signInWithOtp (NOT recovery/reset flows).
    const { error } = await supabasePublic().auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo,
        // Explicit: this app relies on OTP sign-in to create users for first-time flows (signup/invites).
        shouldCreateUser: true,
      },
    });

    if (error) {
      console.error("[auth otp] error", {
        requestId,
        code: (error as any)?.status ?? null,
        message: error.message,
        name: (error as any)?.name ?? null,
      });

      const classified = classifySupabaseOtpError(error.message);
      return {
        ok: false,
        requestId,
        retryAfterSeconds: classified.retryAfterSeconds,
        error: classified.error,
        ...(isProduction
          ? {}
          : {
              debug: {
                supabaseMessage: error.message ?? null,
                status: (error as any)?.status ?? null,
              },
            }),
      };
    }

    console.error("[auth otp] success", { requestId });
    return { ok: true, requestId, retryAfterSeconds: OTP_COOLDOWN_SECONDS };
  } catch (thrown) {
    const message =
      thrown instanceof Error ? thrown.message : typeof thrown === "string" ? thrown : "unknown error";
    console.error("[auth otp] error", {
      requestId,
      code: null,
      message,
      name: thrown instanceof Error ? thrown.name : null,
    });

    return {
      ok: false,
      requestId,
      retryAfterSeconds: 0,
      error: MAGIC_LINK_ERROR_MESSAGE,
      ...(isProduction ? {} : { debug: { supabaseMessage: message, status: null } }),
    };
  }
}

