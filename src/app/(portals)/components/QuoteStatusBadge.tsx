import clsx from "clsx";

import {
  getQuoteStatusLabel,
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";

const BADGE_VARIANTS: Record<QuoteStatus, string> = {
  submitted: "pill-info",
  in_review: "pill-info",
  quoted: "pill-info",
  approved: "pill-success",
  won: "pill-success",
  lost: "pill-warning",
  cancelled: "pill-muted",
};

type QuoteStatusBadgeProps = {
  status: QuoteStatus | string | null | undefined;
  size?: "sm" | "md";
  className?: string;
};

export function QuoteStatusBadge({
  status,
  size = "md",
  className,
}: QuoteStatusBadgeProps) {
  const normalized = normalizeQuoteStatus(status ?? undefined);
  const label = getQuoteStatusLabel(normalized);
  const variant = BADGE_VARIANTS[normalized] ?? "pill-muted";

  return (
    <span
      className={clsx(
        "pill",
        size === "sm" && "pill-table",
        variant,
        className,
      )}
    >
      {label}
    </span>
  );
}
