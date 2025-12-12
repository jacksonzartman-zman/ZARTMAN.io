import type { ListState, ListStateConfig } from "@/app/(portals)/lib/listState";

export type SupplierRfqsSortKey = "recently_updated" | "newest";
export type SupplierRfqsStatusFilter = "open" | "closed";

export type SupplierRfqsListState = ListState<SupplierRfqsSortKey, SupplierRfqsStatusFilter>;

export const SUPPLIER_RFQS_LIST_STATE_CONFIG: ListStateConfig<
  SupplierRfqsSortKey,
  SupplierRfqsStatusFilter
> = {
  defaultPageSize: 25,
  pageSizeOptions: [10, 25, 50, 100],

  // Default matches the existing behavior (“sorted by latest activity”).
  defaultSort: "recently_updated",
  allowedSorts: ["recently_updated", "newest"],

  allowedStatuses: ["open", "closed"],
};

