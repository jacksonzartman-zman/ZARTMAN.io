import clsx from "clsx";
import {
  formatQuoteWorkspaceStatusLabel,
  type QuoteWorkspaceStatus,
} from "@/lib/quote/workspaceStatus";

export function StatusPill({
  status,
  className,
}: {
  status: QuoteWorkspaceStatus;
  className?: string;
}) {
  const variant =
    status === "awarded"
      ? "pill-success"
      : status === "in_review"
        ? "pill-info"
        : "pill-muted";

  return (
    <span
      className={clsx(
        "pill px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
        variant,
        className,
      )}
    >
      {formatQuoteWorkspaceStatusLabel(status)}
    </span>
  );
}

