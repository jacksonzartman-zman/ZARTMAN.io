import clsx from "clsx";
import Link from "next/link";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { formatShortId } from "@/lib/awards";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import {
  loadAdminActivityFeed,
  type AdminActivityRow,
} from "@/server/admin/activityFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminActivityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type WindowKey = "24h" | "7d" | "30d";
type KindKey = "all" | "awards" | "kickoff" | "messages" | "capacity";

const WINDOW_OPTIONS: Array<{ key: WindowKey; label: string; ms: number }> = [
  { key: "24h", label: "Last 24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Last 7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "Last 30d", ms: 30 * 24 * 60 * 60 * 1000 },
];

const KIND_OPTIONS: Array<{ key: KindKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "awards", label: "Awards" },
  { key: "kickoff", label: "Kickoff" },
  { key: "messages", label: "Messages" },
  { key: "capacity", label: "Capacity" },
];

export default async function AdminActivityPage({
  searchParams,
}: AdminActivityPageProps) {
  const params = await resolveSearchParams(searchParams);
  const windowKey = normalizeWindowKey(params.get("window")) ?? "7d";
  const kindKey = normalizeKindKey(params.get("type")) ?? "all";

  const windowMs = WINDOW_OPTIONS.find((w) => w.key === windowKey)?.ms ?? 7 * 864e5;
  const since = new Date(Date.now() - windowMs).toISOString();

  const rows = await loadAdminActivityFeed({ limit: 200, since });
  const filtered = rows.filter((row) => matchesKind(row, kindKey));

  return (
    <AdminDashboardShell
      eyebrow="Admin"
      title="Activity"
      description="Recent quote events across the system."
    >
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Time window
              </p>
              {WINDOW_OPTIONS.map((opt) => (
                <PillLink
                  key={opt.key}
                  active={opt.key === windowKey}
                  href={buildHref({ window: opt.key, type: kindKey })}
                  label={opt.label}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Event type
              </p>
              {KIND_OPTIONS.map((opt) => (
                <PillLink
                  key={opt.key}
                  active={opt.key === kindKey}
                  href={buildHref({ window: windowKey, type: opt.key })}
                  label={opt.label}
                />
              ))}
            </div>
          </div>
        </section>

        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400">
            No activity in this window yet.
          </p>
        ) : (
          <section className="overflow-hidden rounded-2xl border border-slate-900 bg-slate-950/40">
            <div className="grid grid-cols-[140px_minmax(0,1.4fr)_130px_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-slate-900/60 px-6 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <div>Time</div>
              <div>Event</div>
              <div>Quote</div>
              <div>Customer</div>
              <div>Supplier</div>
            </div>
            <div className="divide-y divide-slate-900/60">
              {filtered.map((row) => (
                <ActivityRow key={row.id} row={row} />
              ))}
            </div>
          </section>
        )}
      </div>
    </AdminDashboardShell>
  );
}

function ActivityRow({ row }: { row: AdminActivityRow }) {
  const relative =
    formatRelativeTimeFromTimestamp(toTimestamp(row.occurredAt)) ?? "—";
  const absolute = formatDateTime(row.occurredAt, { includeTime: true }) ?? row.occurredAt;
  const quoteHref = `/admin/quotes/${row.quoteId}#timeline`;

  return (
    <Link
      href={quoteHref}
      className="grid grid-cols-[140px_minmax(0,1.4fr)_130px_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-6 py-3 transition hover:bg-slate-900/30"
    >
      <div className="text-xs text-slate-400" title={absolute}>
        {relative}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-100">
          {row.title}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          {formatPhaseLabel(row.phase)}
          {row.description ? ` · ${row.description}` : ""}
        </p>
      </div>
      <div className="text-sm font-medium text-slate-200">
        {formatShortId(row.quoteId)}
      </div>
      <div className="truncate text-sm text-slate-200">
        {row.customerName ?? "—"}
      </div>
      <div className="truncate text-sm text-slate-200">
        {row.supplierName ?? "—"}
      </div>
    </Link>
  );
}

function PillLink({
  active,
  href,
  label,
}: {
  active: boolean;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "rounded-full border px-3 py-1 text-xs font-semibold transition",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          : "border-slate-800 bg-slate-950/40 text-slate-200 hover:border-slate-700 hover:text-white",
      )}
    >
      {label}
    </Link>
  );
}

function formatPhaseLabel(phase: string): string {
  if (phase === "rfq") return "RFQ";
  if (phase === "bidding") return "Bidding";
  if (phase === "award") return "Award";
  if (phase === "kickoff") return "Kickoff";
  if (phase === "execution") return "Execution";
  return "Other";
}

function matchesKind(row: AdminActivityRow, kind: KindKey): boolean {
  const type = (row.type ?? "").toString().trim().toLowerCase();
  if (kind === "all") return true;
  if (kind === "awards") {
    return type === "awarded" || type === "quote_won" || type === "bid_won";
  }
  if (kind === "kickoff") {
    return type.startsWith("kickoff_");
  }
  if (kind === "messages") {
    return type === "message_posted" || type === "quote_message_posted";
  }
  if (kind === "capacity") {
    return type === "capacity_updated" || type === "capacity_update_requested";
  }
  return true;
}

function buildHref(args: { window: WindowKey; type: KindKey }): string {
  const params = new URLSearchParams();
  params.set("window", args.window);
  params.set("type", args.type);
  return `/admin/activity?${params.toString()}`;
}

function normalizeWindowKey(value: string | null): WindowKey | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "24h") return "24h";
  if (normalized === "7d") return "7d";
  if (normalized === "30d") return "30d";
  return null;
}

function normalizeKindKey(value: string | null): KindKey | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "all") return "all";
  if (normalized === "awards") return "awards";
  if (normalized === "kickoff") return "kickoff";
  if (normalized === "messages") return "messages";
  if (normalized === "capacity") return "capacity";
  return null;
}

async function resolveSearchParams(
  searchParams: AdminActivityPageProps["searchParams"],
): Promise<URLSearchParams> {
  const resolved = searchParams ? await searchParams : undefined;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved ?? {})) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      params.set(key, value[0]);
    }
  }
  return params;
}

