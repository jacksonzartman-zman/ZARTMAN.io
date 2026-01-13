import {
  type ListStateConfig,
  type ListState,
} from "@/app/(portals)/lib/listState";

export type AdminQuotesSortKey =
  | "inbox"
  | "newest_rfq"
  | "latest_bid_activity"
  | "awarded_recently"
  | "most_bids";

export type AdminQuotesStatusFilter = "submitted" | "in_review" | "won" | "lost";

export type AdminQuotesListState = ListState<AdminQuotesSortKey, AdminQuotesStatusFilter>;

export const ADMIN_QUOTES_LIST_STATE_CONFIG: ListStateConfig<
  AdminQuotesSortKey,
  AdminQuotesStatusFilter
> = {
  // Keep existing URLs stable for admin pages.
  qParam: "search",

  defaultPageSize: 25,
  pageSizeOptions: [10, 25, 50, 100],

  defaultSort: "inbox",
  allowedSorts: [
    "inbox",
    "newest_rfq",
    "latest_bid_activity",
    "awarded_recently",
    "most_bids",
  ],

  allowedStatuses: ["submitted", "in_review", "won", "lost"],
};
