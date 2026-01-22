import Link from "next/link";
import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { formatDateTime } from "@/lib/formatDate";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { getAdminOpsInboxRows, type AdminOpsInboxRow } from "@/server/ops/inbox";
import { getOpsSlaConfig } from "@/server/ops/settings";
import { listProviders } from "@/server/providers";
import { OpsInboxDispatchDrawer } from "./OpsInboxDispatchDrawer";
import { IntroRequestsHandleButton } from "./IntroRequestsHandleButton";

export const dynamic = "force-dynamic";

const DESTINATION_STATUS_VALUES = [
  "queued",
  "sent",
  "submitted",
  "viewed",
  "quoted",
  "declined",
  "error",
] as const;

const DESTINATION_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "sent", label: "Sent" },
  { value: "submitted", label: "Submitted" },
  { value: "viewed", label: "Viewed" },
  { value: "quoted", label: "Quoted" },
  { value: "declined", label: "Declined" },
  { value: "error", label: "Error" },
] as const;

type DestinationStatus = (typeof DESTINATION_STATUS_VALUES)[number];
type DestinationStatusFilter = DestinationStatus | "all";

const DESTINATION_STATUS_META: Record<
  DestinationStatus,
  { label: string; className: string }
> = {
  queued: { label: "Queued", className: "pill-muted" },
  sent: { label: "Sent", className: "pill-info" },
  submitted: { label: "Submitted", className: "pill-info" },
  viewed: { label: "Viewed", className: "pill-info" },
  quoted: { label: "Quoted", className: "pill-success" },
  declined: { label: "Declined", className: "pill-warning" },
  error: {
    label: "Error",
    className: "border-red-400/60 bg-red-500/15 text-red-100",
  },
};

type NeedsActionChip = {
  key:
    | "needsReplyCount"
    | "errorsCount"
    | "queuedStaleCount"
    | "messageNeedsReplyCount"
    | "threadNeedsReplyCount"
    | "threadReplyOverdueCount"
    | "introRequestsCount";
  label: string;
  className: string;
};

const NEEDS_ACTION_CHIPS: NeedsActionChip[] = [
  {
    key: "introRequestsCount",
    label: "Intro requests",
    className: "pill-info",
  },
  {
    key: "needsReplyCount",
    label: "Offer needs reply",
    className: "pill-warning",
  },
  {
    key: "messageNeedsReplyCount",
    label: "Msg Needs Reply",
    className: "pill-warning",
  },
  {
    key: "threadNeedsReplyCount",
    label: "Needs reply",
    className: "pill-warning",
  },
  {
    key: "threadReplyOverdueCount",
    label: "Overdue",
    className: "border-red-400/60 bg-red-500/15 text-red-100",
  },
  {
    key: "errorsCount",
    label: "Errors",
    className: "border-red-400/60 bg-red-500/15 text-red-100",
  },
  {
    key: "queuedStaleCount",
    label: "Queued stale",
    className: "pill-info",
  },
];

export default async function AdminOpsInboxPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);

  const needsActionOnly = parseToggle(usp.get("needsAction"));
  const messageNeedsReplyOnly = parseToggle(usp.get("messageNeedsReply"));
  const threadNeedsReplyOnly = parseToggle(usp.get("needsReply"));
  const threadOverdueOnly = parseToggle(usp.get("overdue"));
  const introRequestedOnly = parseToggle(usp.get("introRequested"));
  const selectedOnly = parseToggle(usp.get("selected"));
  const destinationStatus = normalizeDestinationStatus(usp.get("destinationStatus"));
  const providerId = normalizeFilterValue(usp.get("provider"));

  const slaConfig = await getOpsSlaConfig();

  const [rows, providers] = await Promise.all([
    getAdminOpsInboxRows({
      limit: 200,
      filters: {
        needsActionOnly,
        messageNeedsReplyOnly,
        threadNeedsReplyOnly,
        threadOverdueOnly,
        introRequestedOnly,
        selectedOnly,
        destinationStatus: destinationStatus === "all" ? null : destinationStatus,
        providerId: providerId || null,
      },
      slaConfig,
    }),
    listProviders(),
  ]);

  const providerLabelById = Object.fromEntries(
    providers.map((provider) => [provider.id, provider.name]),
  );

  const preparedRows = rows.map((row) => {
    const lastActivityMs = resolveLastActivityMs(row);
    return {
      row,
      lastActivityMs,
      needsAction: row.summary.needsActionCount > 0,
    };
  });

  const introQueueCount = preparedRows.reduce((acc, item) => acc + (item.row.summary.introRequestsCount ?? 0), 0);

  const sortedRows = preparedRows.sort((a, b) => {
    if (a.needsAction !== b.needsAction) {
      return a.needsAction ? -1 : 1;
    }
    if (a.lastActivityMs !== b.lastActivityMs) {
      return b.lastActivityMs - a.lastActivityMs;
    }
    return a.row.quote.id.localeCompare(b.row.quote.id);
  });

  const hasFilters =
    needsActionOnly ||
    messageNeedsReplyOnly ||
    threadNeedsReplyOnly ||
    threadOverdueOnly ||
    introRequestedOnly ||
    selectedOnly ||
    destinationStatus !== "all" ||
    providerId.length > 0;

  const actionButtonClass = clsx(
    secondaryCtaClasses,
    ctaSizeClasses.sm,
    "min-w-[5.5rem] justify-center",
  );
  const introPresetHref = "/admin/ops/inbox?introRequested=1";
  const headerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link
        href={introPresetHref}
        className={clsx(
          ctaSizeClasses.sm,
          introRequestedOnly
            ? "rounded-xl border border-emerald-400/60 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-100"
            : "rounded-xl border border-emerald-400/40 bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400",
        )}
      >
        Intro Requests{introQueueCount > 0 ? ` (${introQueueCount})` : ""}
      </Link>
      <Link
        href="/admin/ops/settings"
        className={clsx(secondaryCtaClasses, ctaSizeClasses.sm)}
      >
        SLA settings
      </Link>
    </div>
  );

  return (
    <AdminDashboardShell
      title="Ops Inbox"
      description="Cockpit for Kayak dispatch and destination follow-ups."
      actions={headerActions}
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form
          method="GET"
          action="/admin/ops/inbox"
          className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Destination status
              </span>
              <select
                name="destinationStatus"
                defaultValue={destinationStatus}
                className="w-full min-w-48 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                {DESTINATION_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Provider
              </span>
              <select
                name="provider"
                defaultValue={providerId || "all"}
                className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="all">All</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
                {providerId && !providers.some((provider) => provider.id === providerId) ? (
                  <option value={providerId}>Unknown provider ({providerId})</option>
                ) : null}
              </select>
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                name="needsAction"
                value="1"
                defaultChecked={needsActionOnly}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
              />
              Needs action only
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                name="messageNeedsReply"
                value="1"
                defaultChecked={messageNeedsReplyOnly}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
              />
              Message needs reply only
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                name="needsReply"
                value="1"
                defaultChecked={threadNeedsReplyOnly}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
              />
              Needs reply only
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                name="overdue"
                value="1"
                defaultChecked={threadOverdueOnly}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
              />
              Overdue only
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                name="introRequested"
                value="1"
                defaultChecked={introRequestedOnly}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
              />
              Intro requests only
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                name="selected"
                value="1"
                defaultChecked={selectedOnly}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
              />
              Selected only
            </label>
          </div>

          <button
            type="submit"
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            Apply filters
          </button>
        </form>
      </section>

      <div className="mt-6 overflow-x-auto">
        <AdminTableShell
          head={
            <tr>
              <th className="px-5 py-4">Quote</th>
              <th className="px-5 py-4">Customer</th>
              <th className="px-5 py-4">Destinations</th>
              <th className="px-5 py-4">Needs action</th>
              <th className="px-5 py-4">Last activity</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          }
          body={
            sortedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-base text-slate-300">
                  <p className="font-medium text-slate-100">
                    {hasFilters
                      ? "No quotes match these dispatch filters."
                      : "No dispatch work in the Ops Inbox yet."}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {hasFilters
                      ? "Try widening the filters to see more destinations."
                      : "Kick off dispatch by adding destinations from a quote detail page."}
                  </p>
                </td>
              </tr>
            ) : (
              sortedRows.map(({ row, lastActivityMs, needsAction }) => {
                const quoteLabel = row.quote.title?.trim() || row.quote.id;
                const quoteHref = `/admin/quotes/${row.quote.id}`;
                const displayName =
                  row.customer.name?.trim() || row.customer.email?.trim() || "—";
                const email = row.customer.email?.trim() || "";
                const lastActivity = lastActivityMs > 0 ? new Date(lastActivityMs) : null;
                const hasIntroRequests = (row.summary.introRequestsCount ?? 0) > 0;

                return (
                  <tr
                    key={row.quote.id}
                    className={clsx(
                      "transition hover:bg-slate-900/40",
                  row.summary.threadReplyOverdueCount > 0
                    ? "bg-red-500/5"
                    : hasIntroRequests
                      ? "bg-emerald-500/5"
                      : "bg-slate-950/40",
                    )}
                  >
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="flex flex-col">
                        <Link
                          href={quoteHref}
                          className="text-sm font-semibold text-emerald-100 hover:text-emerald-200"
                        >
                          {quoteLabel}
                        </Link>
                        {row.quote.title && row.quote.title.trim() !== row.quote.id ? (
                          <span className="text-xs text-slate-500">{row.quote.id}</span>
                        ) : null}
                        {hasIntroRequests ? (
                          <span className="mt-1 inline-flex w-fit rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                            Intro requested
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-100">
                          {displayName}
                        </span>
                        {email ? (
                          <a
                            href={`mailto:${email}`}
                            className="text-xs text-slate-400 hover:text-emerald-200"
                          >
                            {email}
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="flex flex-wrap gap-2">
                        {DESTINATION_STATUS_VALUES.map((status) => {
                          const count = row.summary.counts[status] ?? 0;
                          if (count <= 0) return null;
                          const meta = DESTINATION_STATUS_META[status];
                          return (
                            <span
                              key={status}
                              className={clsx("pill pill-table", meta.className)}
                            >
                              {meta.label} {count}
                            </span>
                          );
                        })}
                        {row.destinations.length === 0 ? (
                          <span className="pill pill-table pill-muted">No destinations</span>
                        ) : null}
                      </div>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                      <div className="flex flex-wrap gap-2">
                        {NEEDS_ACTION_CHIPS.map((chip) => {
                          const count = row.summary[chip.key] ?? 0;
                          if (count <= 0) return null;
                          return (
                            <span
                              key={chip.key}
                              className={clsx("pill pill-table", chip.className)}
                            >
                              {chip.label}: {count}
                            </span>
                          );
                        })}
                        {!needsAction ? (
                          <span className="pill pill-table pill-muted">All clear</span>
                        ) : null}
                      </div>
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-300")}>
                      {formatDateTime(lastActivity, { includeTime: true })}
                    </td>
                    <td className={clsx(adminTableCellClass, "px-5 py-4 text-right")}>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link href={quoteHref} className={actionButtonClass}>
                          Open
                        </Link>
                        {hasIntroRequests ? (
                          <IntroRequestsHandleButton
                            quoteId={row.quote.id}
                            providerIds={row.summary.introRequestProviderIds ?? []}
                            providerLabelById={providerLabelById}
                            actionClassName={actionButtonClass}
                          />
                        ) : null}
                        <OpsInboxDispatchDrawer
                          row={row}
                          actionClassName={actionButtonClass}
                          slaConfig={slaConfig}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )
          }
        />
      </div>
    </AdminDashboardShell>
  );
}

function resolveLastActivityMs(row: AdminOpsInboxRow): number {
  let latest = toMs(row.quote.created_at);
  for (const destination of row.destinations) {
    latest = Math.max(
      latest,
      toMs(destination.last_status_at),
      toMs(destination.sent_at),
      toMs(destination.submitted_at),
    );
  }
  latest = Math.max(
    latest,
    toMs(row.summary.lastCustomerMessageAt),
    toMs(row.summary.lastSupplierMessageAt),
    toMs(row.summary.lastAdminMessageAt),
  );
  return latest;
}

function toMs(value: string | null | undefined): number {
  if (!value) return -1;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function normalizeDestinationStatus(value: unknown): DestinationStatusFilter {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if ((DESTINATION_STATUS_VALUES as readonly string[]).includes(normalized)) {
    return normalized as DestinationStatusFilter;
  }
  return "all";
}

function parseToggle(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function normalizeFilterValue(value: string | null): string {
  const normalized = value?.trim();
  if (!normalized || normalized === "all") return "";
  return normalized;
}

