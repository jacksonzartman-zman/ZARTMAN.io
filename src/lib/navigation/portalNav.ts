export function normalizePathname(input: string): string {
  if (!input) return "/";
  const trimmed = input.trim();
  if (!trimmed) return "/";

  // Be resilient if a full URL or query/hash sneaks in.
  // `usePathname()` returns only the pathname, but some callers may not.
  const withoutHash = trimmed.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";

  // If the remaining string looks like a full URL, take its pathname.
  if (withoutQuery.startsWith("http://") || withoutQuery.startsWith("https://")) {
    try {
      const url = new URL(withoutQuery);
      return url.pathname || "/";
    } catch {
      // Fall through to basic normalization.
    }
  }

  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

/**
 * Returns true when `href` should be considered active for `pathname`.
 *
 * This intentionally uses a "segment boundary" prefix match:
 * - `/supplier/quotes/123` is active for `/supplier/quotes`
 * - `/supplier-foo` is NOT active for `/supplier`
 */
export function isNavHrefActive(pathname: string, href: string): boolean {
  const path = normalizePathname(pathname);
  const target = normalizePathname(href);
  return path === target || path.startsWith(`${target}/`);
}

/**
 * Picks the single best active href from a set of candidates.
 *
 * If multiple hrefs match a pathname (e.g. `/supplier` and `/supplier/quotes`),
 * the longest (most specific) href wins. Exact match always wins.
 */
export function pickBestActiveHref(
  pathname: string,
  hrefs: string[],
  isActive: (pathname: string, href: string) => boolean = isNavHrefActive,
): string | null {
  const path = normalizePathname(pathname);
  let bestHref: string | null = null;
  let bestScore = -1;

  for (const rawHref of hrefs) {
    if (typeof rawHref !== "string" || !rawHref) continue;
    const href = normalizePathname(rawHref);

    // Exact matches should always win.
    if (href === path) {
      const score = 1_000_000 + href.length;
      if (score > bestScore) {
        bestScore = score;
        bestHref = href;
      }
      continue;
    }

    if (!isActive(path, href)) continue;
    const score = href.length;
    if (score > bestScore) {
      bestScore = score;
      bestHref = href;
    }
  }

  return bestHref;
}

