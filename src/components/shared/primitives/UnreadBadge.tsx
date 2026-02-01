import clsx from "clsx";
import { CountBadge } from "@/components/shared/primitives/CountBadge";

function formatCompactCount(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n > 99) return "99+";
  return String(n);
}

export function UnreadBadge({
  count,
  show,
  label = "New",
  className,
}: {
  count?: number | null;
  show?: boolean;
  label?: string;
  className?: string;
}) {
  const numeric =
    typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;

  if ((numeric ?? 0) <= 0 && !show) {
    return null;
  }

  const value = numeric && numeric > 0 ? formatCompactCount(numeric) : label;

  return (
    <CountBadge
      tone="info"
      size="sm"
      className={clsx(
        numeric && numeric > 0 ? "min-w-[1.6rem] tabular-nums" : "",
        className,
      )}
      aria-label={numeric && numeric > 0 ? `Unread (${formatCompactCount(numeric)})` : "Unread"}
      title={numeric && numeric > 0 ? "Unread" : label}
    >
      {value}
    </CountBadge>
  );
}

