import type { ListState, ListStateConfig } from "@/app/(portals)/lib/listState";

export type CustomerQuotesSortKey = "recently_updated" | "newest";

export type CustomerQuotesListState = ListState<CustomerQuotesSortKey, never>;

export const CUSTOMER_QUOTES_LIST_STATE_CONFIG: ListStateConfig<CustomerQuotesSortKey, never> =
  {
    defaultPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],

    // Default matches the existing customer list behavior (“sorted by latest update”).
    defaultSort: "recently_updated",
    allowedSorts: ["recently_updated", "newest"],
  };

