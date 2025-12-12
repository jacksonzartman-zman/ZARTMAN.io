// src/app/(portals)/lib/listState.ts

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSizeOption = (typeof DEFAULT_PAGE_SIZE_OPTIONS)[number];

export type ListState<Sort extends string = string, Status extends string = string> = {
  page: number;
  pageSize: PageSizeOption;
  sort?: Sort;
  status?: Status;
  hasBids?: boolean;
  awarded?: boolean;
  q: string;
};

export type ListStateConfig<Sort extends string = string, Status extends string = string> = {
  /** Path/query param names */
  pageParam?: string;
  pageSizeParam?: string;
  sortParam?: string;
  statusParam?: string;
  qParam?: string;
  hasBidsParam?: string;
  awardedParam?: string;

  /** Defaults + validation */
  defaultPageSize?: PageSizeOption;
  pageSizeOptions?: readonly PageSizeOption[];
  defaultSort?: Sort;
  allowedSorts?: readonly Sort[];
  allowedStatuses?: readonly Status[];

  /** If true, also accept legacy/alias keys when parsing (e.g. q/search). */
  allowAliases?: boolean;
};

export type SearchParamsLike =
  | URLSearchParams
  | { get: (key: string) => string | null }
  | Record<string, string | string[] | null | undefined>
  | null
  | undefined;

function getFirst(value?: string | string[] | null): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

function isURLSearchParamsLike(value: unknown): value is { get: (key: string) => string | null } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).get === "function"
  );
}

function readParam(searchParams: SearchParamsLike, key: string): string | undefined {
  if (!searchParams) return undefined;

  if (isURLSearchParamsLike(searchParams)) {
    const value = searchParams.get(key);
    return value ?? undefined;
  }

  const record = searchParams as Record<string, string | string[] | null | undefined>;
  return getFirst(record[key]);
}

function normalizeInt(raw: string | undefined, fallback: number): number {
  if (typeof raw !== "string") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function normalizePage(raw: string | undefined): number {
  return Math.max(1, normalizeInt(raw, 1));
}

function normalizePageSize(
  raw: string | undefined,
  allowed: readonly PageSizeOption[],
  fallback: PageSizeOption,
): PageSizeOption {
  const parsed = normalizeInt(raw, fallback);
  const candidate = parsed as PageSizeOption;
  return allowed.includes(candidate) ? candidate : fallback;
}

function normalizeEnumValue<T extends string>(
  raw: string | undefined,
  allowed: readonly T[] | undefined,
  fallback: T | undefined,
): T | undefined {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!normalized) return fallback;

  if (!allowed || allowed.length === 0) {
    // If no allow-list is provided, accept any non-empty value.
    return normalized as T;
  }

  return allowed.includes(normalized as T) ? (normalized as T) : fallback;
}

function normalizeBooleanFlag(raw: string | undefined): boolean {
  return (raw ?? "").trim() === "1";
}

export function parseListState<Sort extends string = string, Status extends string = string>(
  searchParams: SearchParamsLike,
  config: ListStateConfig<Sort, Status> = {},
): ListState<Sort, Status> {
  const {
    pageParam = "page",
    pageSizeParam = "pageSize",
    sortParam = "sort",
    statusParam = "status",
    qParam = "q",
    hasBidsParam = "hasBids",
    awardedParam = "awarded",
    pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
    defaultPageSize = 25,
    defaultSort,
    allowedSorts,
    allowedStatuses,
    allowAliases = true,
  } = config;

  const rawPage = readParam(searchParams, pageParam);
  const rawPageSize = readParam(searchParams, pageSizeParam);

  const rawSort = readParam(searchParams, sortParam);
  const rawStatus = readParam(searchParams, statusParam);

  const rawQ =
    readParam(searchParams, qParam) ??
    (allowAliases && qParam !== "search" ? readParam(searchParams, "search") : undefined) ??
    (allowAliases && qParam !== "q" ? readParam(searchParams, "q") : undefined);

  const rawHasBids = readParam(searchParams, hasBidsParam);
  const rawAwarded = readParam(searchParams, awardedParam);

  const page = normalizePage(rawPage);
  const pageSize = normalizePageSize(rawPageSize, pageSizeOptions, defaultPageSize);

  const sort = normalizeEnumValue(rawSort, allowedSorts, defaultSort);
  const status = normalizeEnumValue(rawStatus, allowedStatuses, undefined);

  const q = typeof rawQ === "string" ? rawQ.trim() : "";

  return {
    page,
    pageSize,
    sort,
    status,
    hasBids: normalizeBooleanFlag(rawHasBids),
    awarded: normalizeBooleanFlag(rawAwarded),
    q,
  };
}

export function buildListQuery<Sort extends string = string, Status extends string = string>(
  state: ListState<Sort, Status>,
  config: ListStateConfig<Sort, Status> = {},
): string {
  const {
    pageParam = "page",
    pageSizeParam = "pageSize",
    sortParam = "sort",
    statusParam = "status",
    qParam = "q",
    hasBidsParam = "hasBids",
    awardedParam = "awarded",
    defaultPageSize = 25,
    defaultSort,
  } = config;

  const params = new URLSearchParams();

  if (state.page > 1) params.set(pageParam, String(state.page));
  if (state.pageSize !== defaultPageSize) params.set(pageSizeParam, String(state.pageSize));

  if (state.sort && state.sort !== defaultSort) params.set(sortParam, state.sort);
  if (state.status) params.set(statusParam, state.status);

  const q = state.q.trim();
  if (q.length > 0) params.set(qParam, q);

  if (state.hasBids) params.set(hasBidsParam, "1");
  if (state.awarded) params.set(awardedParam, "1");

  return params.toString();
}

export function buildListUrl<Sort extends string = string, Status extends string = string>(
  basePath: string,
  state: ListState<Sort, Status>,
  config: ListStateConfig<Sort, Status> = {},
): string {
  const query = buildListQuery(state, config);
  return query ? `${basePath}?${query}` : basePath;
}

function withPageReset<Sort extends string, Status extends string>(
  state: ListState<Sort, Status>,
): ListState<Sort, Status> {
  return { ...state, page: 1 };
}

export function setPage<Sort extends string = string, Status extends string = string>(
  state: ListState<Sort, Status>,
  nextPage: number,
  config: ListStateConfig<Sort, Status> = {},
): string {
  const page = Math.max(1, Number.isFinite(nextPage) ? Math.floor(nextPage) : 1);
  return buildListQuery({ ...state, page }, config);
}

export function setPageSize<Sort extends string = string, Status extends string = string>(
  state: ListState<Sort, Status>,
  nextPageSize: number,
  config: ListStateConfig<Sort, Status> = {},
): string {
  const allowed = config.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;
  const fallback = config.defaultPageSize ?? 25;
  const normalized = normalizePageSize(String(nextPageSize), allowed, fallback);
  return buildListQuery(withPageReset({ ...state, pageSize: normalized }), config);
}

export function setSearch<Sort extends string = string, Status extends string = string>(
  state: ListState<Sort, Status>,
  nextQ: string,
  config: ListStateConfig<Sort, Status> = {},
): string {
  const q = typeof nextQ === "string" ? nextQ.trim() : "";
  return buildListQuery(withPageReset({ ...state, q }), config);
}

export function setSort<Sort extends string = string, Status extends string = string>(
  state: ListState<Sort, Status>,
  nextSort: Sort,
  config: ListStateConfig<Sort, Status> = {},
): string {
  const validated = normalizeEnumValue(String(nextSort), config.allowedSorts as readonly Sort[] | undefined, config.defaultSort);
  return buildListQuery(withPageReset({ ...state, sort: validated }), config);
}

export function setFilter<Sort extends string = string, Status extends string = string>(
  state: ListState<Sort, Status>,
  patch: Partial<Pick<ListState<Sort, Status>, "status" | "hasBids" | "awarded">>,
  config: ListStateConfig<Sort, Status> = {},
): string {
  const patchHasStatusKey = Object.prototype.hasOwnProperty.call(patch, "status");

  const nextStatus = normalizeEnumValue(
    typeof patch.status === "string" ? patch.status : undefined,
    config.allowedStatuses as readonly Status[] | undefined,
    undefined,
  );

  const nextState: ListState<Sort, Status> = {
    ...state,
    // If the caller explicitly sets status (even to undefined), treat that as a change.
    // This allows clearing the status filter by passing `{ status: undefined }`.
    status: patchHasStatusKey ? nextStatus : state.status,
    hasBids: patch.hasBids === undefined ? state.hasBids : Boolean(patch.hasBids),
    awarded: patch.awarded === undefined ? state.awarded : Boolean(patch.awarded),
  };

  return buildListQuery(withPageReset(nextState), config);
}
