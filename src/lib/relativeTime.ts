const MINUTE_IN_MS = 60 * 1000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;

export function toTimestamp(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return timestamp;
}

export function formatRelativeTimeFromTimestamp(
  timestamp: number | null | undefined,
): string | null {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
    return null;
  }
  const now = Date.now();
  const delta = now - timestamp;
  if (delta < MINUTE_IN_MS) {
    return "just now";
  }
  if (delta < HOUR_IN_MS) {
    const minutes = Math.max(1, Math.round(delta / MINUTE_IN_MS));
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (delta < DAY_IN_MS) {
    const hours = Math.round(delta / HOUR_IN_MS);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(delta / DAY_IN_MS);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatRelativeTimeCompactFromTimestamp(
  timestamp: number | null | undefined,
): string | null {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
    return null;
  }
  const now = Date.now();
  const delta = now - timestamp;
  if (delta < MINUTE_IN_MS) {
    return "just now";
  }
  if (delta < HOUR_IN_MS) {
    const minutes = Math.max(1, Math.round(delta / MINUTE_IN_MS));
    return `${minutes}m ago`;
  }
  if (delta < DAY_IN_MS) {
    const hours = Math.max(1, Math.round(delta / HOUR_IN_MS));
    return `${hours}h ago`;
  }
  const days = Math.max(1, Math.round(delta / DAY_IN_MS));
  return `${days}d ago`;
}
