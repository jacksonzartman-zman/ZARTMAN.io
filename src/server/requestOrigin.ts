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

  // Only accept explicit https origins.
  if (url.protocol !== "https:") {
    return null;
  }

  const origin = trimTrailingSlash(url.origin);
  if (origin === "https://www.zartman.io" || origin === "https://zartman.io") {
    return origin;
  }

  const hostname = url.hostname.toLowerCase();
  // Allow any https://*.vercel.app preview.
  if (hostname.endsWith(".vercel.app") && hostname.split(".").length >= 3) {
    return origin;
  }

  return null;
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
 * Prefer Vercel proxy headers to determine the *true* request origin.
 *
 * Order:
 * - x-forwarded-proto + x-forwarded-host
 * - origin header
 * - referer origin
 * - env-derived site URL (legacy)
 * - localhost fallback
 */
export function getRequestOrigin(headers: HeadersLike, options?: GetRequestOriginOptions): string {
  const validatedClientOrigin = validateClientOrigin(options?.clientOrigin);
  if (validatedClientOrigin) {
    return validatedClientOrigin;
  }

  const forwardedProto = firstForwardedValue(readHeader(headers, "x-forwarded-proto"));
  const forwardedHost = firstForwardedValue(readHeader(headers, "x-forwarded-host"));
  if (forwardedHost) {
    const proto = forwardedProto ?? "https";
    return trimTrailingSlash(`${proto}://${forwardedHost}`);
  }

  const originHeader = readHeader(headers, "origin");
  if (originHeader) {
    try {
      return trimTrailingSlash(new URL(originHeader).origin);
    } catch {
      // ignore malformed origin
    }
  }

  const referer = readHeader(headers, "referer");
  if (referer) {
    try {
      return trimTrailingSlash(new URL(referer).origin);
    } catch {
      // ignore malformed referer
    }
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

