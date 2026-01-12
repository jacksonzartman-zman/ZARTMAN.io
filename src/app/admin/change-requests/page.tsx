import Link from "next/link";
import clsx from "clsx";

import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import {
  loadAdminChangeRequests,
  type AdminChangeRequestStatusFilter,
} from "@/server/admin/changeRequests";
import ResolveChangeRequestButton from "./ResolveChangeRequestButton";

export const dynamic = "force-dynamic";

type UiStatusFilter = "all" | "open" | "resolved";

export default async function AdminChangeRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const uiStatus = normalizeUiStatusFilter(usp.get("status"));
  const status = uiStatus as AdminChangeRequestStatusFilter;

  const rows = await loadAdminChangeRequests({ status, limit: 100 });

  return (
    <AdminDashboardShell
      title="Change requests"
      description="Customer-requested changes across active quotes."
      actions={
        <Link
          href="/admin/quotes"
          className={clsx(
            secondaryCtaClasses,
            ctaSizeClasses.sm,
            "whitespace-nowrap border-slate-800 text-slate-100 hover:border-slate-700",
          )}
        >
          Back to quotes
        </Link>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Showing <span className="font-semibold text-slate-200">{uiStatus}</span> ·{" "}
          <span className="font-semibold text-slate-200">{rows.length}</span>
        </p>
        <SegmentedStatusFilter current={uiStatus} />
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-900/70 bg-black/40 px-6 py-5 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Inbox zero</p>
            <p className="mt-1 text-slate-400">
              Nothing to triage right now. New customer change requests will appear here as they
              come in.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
            <ul className="divide-y divide-slate-900/70">
              {rows.map((row) => {
                const createdAtAbsolute = formatDateTime(row.createdAt, {
                  includeTime: true,
                  fallback: "—",
                });
                const createdAtRelative =
                  formatRelativeTimeFromTimestamp(toTimestamp(row.createdAt)) ?? "—";

                const quoteHref = `/admin/quotes/${row.quoteId}#change-requests`;
                const messagesHref = `/admin/quotes/${row.quoteId}#messages`;
                const isOpen = normalizeUiStatusFilter(row.status) === "open";

                return (
                  <li key={row.id} className="px-5 py-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-100">
                              {formatChangeTypeLabel(row.changeType)}
                            </span>
                            <StatusPill status={row.status} />
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <Link
                              href={quoteHref}
                              className="min-w-0 truncate font-medium text-emerald-200 underline-offset-4 hover:underline"
                              title={row.quote.rfqLabel}
                            >
                              {row.quote.rfqLabel}
                            </Link>
                            {row.quote.customerEmail || row.quote.customerName ? (
                              <span className="min-w-0 truncate text-slate-500">
                                {row.quote.customerName && row.quote.customerEmail
                                  ? `${row.quote.customerName} · ${row.quote.customerEmail}`
                                  : row.quote.customerName ?? row.quote.customerEmail}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <p
                            className="whitespace-nowrap text-sm font-medium text-slate-200"
                            title={createdAtAbsolute}
                          >
                            {createdAtAbsolute}
                          </p>
                          <p className="whitespace-nowrap text-xs text-slate-500">
                            {createdAtRelative}
                          </p>
                        </div>
                      </div>

                      <p
                        className="break-anywhere min-w-0 overflow-hidden text-ellipsis text-sm text-slate-200 [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical]"
                        title={row.notes}
                      >
                        {row.notes}
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={quoteHref}
                            className={clsx(
                              secondaryCtaClasses,
                              ctaSizeClasses.sm,
                              "border-slate-800 text-slate-100 hover:border-slate-700",
                            )}
                          >
                            Open quote
                          </Link>
                          <Link
                            href={messagesHref}
                            className={clsx(
                              secondaryCtaClasses,
                              ctaSizeClasses.sm,
                              "border-slate-800 text-slate-100 hover:border-slate-700",
                            )}
                          >
                            Open messages
                          </Link>
                        </div>

                        {isOpen ? <ResolveChangeRequestButton changeRequestId={row.id} /> : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </AdminDashboardShell>
  );
}

function SegmentedStatusFilter({ current }: { current: UiStatusFilter }) {
  const items: Array<{ label: string; value: UiStatusFilter; href: string }> = [
    { label: "All", value: "all", href: "/admin/change-requests" },
    { label: "Open", value: "open", href: "/admin/change-requests?status=open" },
    { label: "Resolved", value: "resolved", href: "/admin/change-requests?status=resolved" },
  ];

  return (
    <div className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/40 p-1">
      {items.map((item) => {
        const active = item.value === current;
        return (
          <Link
            key={item.value}
            href={item.href}
            className={clsx(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition",
              active
                ? "bg-emerald-500/15 text-emerald-100"
                : "text-slate-300 hover:bg-slate-900/40 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = normalizeUiStatusFilter(status);
  const isResolved = normalized === "resolved";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        isResolved
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          : "border-amber-500/30 bg-amber-500/10 text-amber-100",
      )}
    >
      {isResolved ? "Resolved" : "Open"}
    </span>
  );
}

function normalizeUiStatusFilter(value: unknown): UiStatusFilter {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "open" || normalized === "resolved") return normalized;
  return "all";
}

function formatChangeTypeLabel(changeType: string | null | undefined): string {
  switch ((changeType ?? "").trim().toLowerCase()) {
    case "tolerance":
      return "Tolerance";
    case "material_finish":
      return "Material / finish";
    case "lead_time":
      return "Lead time";
    case "shipping":
      return "Shipping";
    case "revision":
      return "Revision";
    default:
      return "Change request";
  }
}

