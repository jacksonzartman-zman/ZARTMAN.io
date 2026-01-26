import "server-only";

type HeadersLike = {
  get(name: string): string | null;
};

type GetRequestOriginOptions = {
  /**
   * Explicit origin from the browser (eg `window.location.origin`).
   * This is validated against an allowlist before use.
   */
  clientOrigin?: string | null;
};

/**
 * Allowlist:
 * - https://www.zartman.io
 * - https://zartman.io
 * - any https://*.vercel.app
 */
function isAllowlistedHttpsOrigin(url: URL): boolean {
  if (url.protocol !== "https:") {
    return false;
  }

  const origin = trimTrailingSlash(url.origin);
  if (origin === "https://www.zartman.io" || origin === "https://zartman.io") {
    return true;
  }

  const hostname = url.hostname.toLowerCase();
  // Allow any https://*.vercel.app preview.
  return hostname.endsWith(".vercel.app") && hostname.split(".").length >= 3;
}

function readHeader(headers: HeadersLike, name: string): string | null {
  const value = headers.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstForwardedValue(value: string | null): string | null {
  if (!value) return null;
  // Vercel may send comma-delimited lists.
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function trimTrailingSlash(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

/**
 * Allowlisted origins we accept from the browser.
 * This prevents arbitrary redirect origins being injected into server actions.
 */
export function validateClientOrigin(clientOrigin?: string | null): string | null {
  if (typeof clientOrigin !== "string") {
    return null;
  }
  const trimmed = clientOrigin.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!isAllowlistedHttpsOrigin(url)) {
    return null;
  }

  return trimTrailingSlash(url.origin);
}

function validateAllowlistedOriginHeader(originHeader: string | null): string | null {
  if (!originHeader) return null;
  try {
    const url = new URL(originHeader);
    if (!isAllowlistedHttpsOrigin(url)) {
      return null;
    }
    return trimTrailingSlash(url.origin);
  } catch {
    return null;
  }
}

function validateAllowlistedForwardedOrigin(
  forwardedProto: string | null,
  forwardedHost: string | null,
): string | null {
  if (!forwardedHost) return null;
  const proto = forwardedProto ?? "https";
  try {
    const url = new URL(`${proto}://${forwardedHost}`);
    if (!isAllowlistedHttpsOrigin(url)) {
      return null;
    }
    return trimTrailingSlash(url.origin);
  } catch {
    return null;
  }
}

export function resolveSafeNextPath(nextPath?: string | null): string | null {
  if (typeof nextPath !== "string") {
    return null;
  }
  const trimmed = nextPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  // Avoid weird control characters / header injection.
  if (/[\r\n]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Determine the true request origin.
 *
 * Priority order:
 * - validated clientOrigin (if provided and allowlisted)
 * - x-forwarded-proto + x-forwarded-host
 * - Origin header (if present and allowlisted)
 * - NEXT_PUBLIC_SITE_URL / SITE_URL fallback
 * - localhost fallback
 */
export function getRequestOrigin(headers: HeadersLike, options?: GetRequestOriginOptions): string {
  const validatedClientOrigin = validateClientOrigin(options?.clientOrigin);
  if (validatedClientOrigin) {
    return validatedClientOrigin;
  }

  const forwardedProto = firstForwardedValue(readHeader(headers, "x-forwarded-proto"));
  const forwardedHost = firstForwardedValue(readHeader(headers, "x-forwarded-host"));
  const allowlistedForwardedOrigin = validateAllowlistedForwardedOrigin(forwardedProto, forwardedHost);
  if (allowlistedForwardedOrigin) {
    return allowlistedForwardedOrigin;
  }

  const allowlistedOriginHeader = validateAllowlistedOriginHeader(readHeader(headers, "origin"));
  if (allowlistedOriginHeader) {
    return allowlistedOriginHeader;
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (baseUrl) {
    return trimTrailingSlash(baseUrl);
  }

  return "http://localhost:3000";
}

export function buildAuthCallbackRedirectTo(args: {
  origin: string;
  nextPath?: string | null;
}): { redirectTo: string; next: string } {
  const origin = trimTrailingSlash(args.origin);
  const next = resolveSafeNextPath(args.nextPath) ?? "/";
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  return { redirectTo, next };
}

