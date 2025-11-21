const DEFAULT_LOCALE = "en-US";

type FormatDateOptions = {
  includeTime?: boolean;
  fallback?: string;
};

type DateLike = string | number | Date | null | undefined;

function toDate(value: DateLike): Date | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(
  value: DateLike,
  { includeTime = false, fallback = "—" }: FormatDateOptions = {},
): string {
  const date = toDate(value);

  if (!date) {
    return fallback;
  }

  const dateText = date.toLocaleDateString(DEFAULT_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (!includeTime) {
    return dateText;
  }

  const timeText = date.toLocaleTimeString(DEFAULT_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${dateText} · ${timeText}`;
}

export function formatDateInputValue(value: DateLike): string {
  const date = toDate(value);

  if (!date) {
    return "";
  }

  const iso = date.toISOString();
  return iso.slice(0, 10);
}
