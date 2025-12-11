import type {
  AdminQuoteListStatus,
  AdminQuotesView,
} from "@/types/adminQuotes";

const ADMIN_QUOTE_VIEW_CONFIG: Record<
  AdminQuotesView,
  {
    label: string;
    description: string;
    statuses: AdminQuoteListStatus[];
  }
> = {
  needs_attention: {
    label: "Needs attention",
    description: "Submitted RFQs that still require supplier engagement or awards.",
    statuses: ["no_bids", "active_bidding"],
  },
  awarded: {
    label: "Awarded",
    description: "RFQs with a winning bid selected.",
    statuses: ["awarded"],
  },
  all: {
    label: "All",
    description: "Show every RFQ regardless of status.",
    statuses: ["no_bids", "active_bidding", "awarded", "closed"],
  },
};

const DEFAULT_VIEW: AdminQuotesView = "needs_attention";

export function normalizeAdminQuotesView(
  raw?: string | null,
): AdminQuotesView {
  const value = (raw ?? "").trim().toLowerCase() as AdminQuotesView;
  return value && value in ADMIN_QUOTE_VIEW_CONFIG ? value : DEFAULT_VIEW;
}

export function viewIncludesStatus(
  view: AdminQuotesView,
  status: AdminQuoteListStatus,
): boolean {
  const config = ADMIN_QUOTE_VIEW_CONFIG[view] ?? ADMIN_QUOTE_VIEW_CONFIG.all;
  return config.statuses.includes(status);
}

export function getAdminQuoteViewOptions(): Array<{
  value: AdminQuotesView;
  label: string;
  description: string;
}> {
  return (Object.keys(ADMIN_QUOTE_VIEW_CONFIG) as AdminQuotesView[]).map(
    (key) => ({
      value: key,
      label: ADMIN_QUOTE_VIEW_CONFIG[key].label,
      description: ADMIN_QUOTE_VIEW_CONFIG[key].description,
    }),
  );
}
