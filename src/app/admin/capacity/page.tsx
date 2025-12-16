import Link from "next/link";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { requireAdminUser } from "@/server/auth";
import {
  getCapacitySnapshots,
  listCapacitySuppliers,
} from "@/server/admin/capacity";
import { getAwardFeedbackSummaryForSupplier } from "@/server/admin/awardFeedback";
import CapacityCalendar, {
  type CapacityCalendarSnapshot,
  type CapacityCalendarSupplier,
  type CapacityCalendarWeek,
} from "@/app/admin/components/CapacityCalendar";
import { formatAwardFeedbackReasonLabel } from "@/lib/awardFeedback";

export const dynamic = "force-dynamic";

function sp(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | undefined {
  const v = searchParams?.[key];
  return Array.isArray(v) ? v[0] : v;
}

function parseYmd(value: string | null): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  return { y, m, d };
}

function utcDateFromYmd(ymd: string | null): Date | null {
  const parsed = parseYmd(ymd);
  if (!parsed) return null;
  const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 0, 0, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  // Reject invalid calendar dates like 2025-02-31 (Date.UTC normalizes instead of failing).
  if (
    date.getUTCFullYear() !== parsed.y ||
    date.getUTCMonth() + 1 !== parsed.m ||
    date.getUTCDate() !== parsed.d
  ) {
    return null;
  }
  return date;
}

function ymdFromUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfUtcWeekMonday(date: Date): Date {
  // 0=Sun, 1=Mon, ... 6=Sat. We want Monday-based weeks.
  const day = date.getUTCDay();
  const delta = (day + 6) % 7; // Mon->0, Tue->1, ... Sun->6
  return addUtcDays(date, -delta);
}

function formatWeekLabel(weekStart: Date): string {
  return weekStart.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function normalizeQueryText(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildHref(
  basePath: string,
  params: Record<string, string | null | undefined>,
): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.trim().length > 0) {
      usp.set(key, value.trim());
    }
  }
  const qs = usp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const spObj = (await searchParams) ?? {};
  const startParam = normalizeQueryText(sp(spObj, "start") ?? null);
  const supplierId = normalizeQueryText(sp(spObj, "supplierId") ?? null);
  const capability = normalizeQueryText(sp(spObj, "capability") ?? null);

  const todayUtc = new Date();
  const defaultStart = startOfUtcWeekMonday(
    new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate())),
  );
  const startDate = utcDateFromYmd(startParam) ?? defaultStart;
  const startWeek = startOfUtcWeekMonday(startDate);
  const endWeek = addUtcDays(startWeek, 21); // 4 weeks inclusive (week starts)

  const [snapshotsResult, suppliersResult] = await Promise.all([
    getCapacitySnapshots({
      startDate: ymdFromUtcDate(startWeek),
      endDate: ymdFromUtcDate(endWeek),
      supplierId,
      capability,
    }),
    listCapacitySuppliers(),
  ]);

  const rawSuppliers = suppliersResult.data.suppliers ?? [];
  const supplierNameById = new Map<string, string>();
  for (const row of rawSuppliers) {
    if (!row?.id) continue;
    const name =
      typeof row.company_name === "string" && row.company_name.trim().length > 0
        ? row.company_name.trim()
        : row.id;
    supplierNameById.set(row.id, name);
  }

  const snapshots: CapacityCalendarSnapshot[] = (snapshotsResult.data.snapshots ?? []).map(
    (row) => ({
      supplierId: row.supplier_id,
      supplierName:
        row.supplier?.company_name?.trim() ||
        supplierNameById.get(row.supplier_id) ||
        row.supplier_id,
      weekStartDate: row.week_start_date,
      capability: row.capability,
      capacityLevel: row.capacity_level,
      createdAt: row.created_at ?? null,
    }),
  );

  const weeks: CapacityCalendarWeek[] = Array.from({ length: 4 }).map((_, idx) => {
    const weekStart = addUtcDays(startWeek, idx * 7);
    return {
      weekStartDate: ymdFromUtcDate(weekStart),
      label: formatWeekLabel(weekStart),
    };
  });

  const capabilitiesInRange = new Set<string>();
  for (const snapshot of snapshots) {
    const normalized = snapshot.capability.trim().toLowerCase();
    if (normalized) capabilitiesInRange.add(normalized);
  }

  const allSupplierOptions: CapacityCalendarSupplier[] = rawSuppliers
    .map((s) => ({
      id: s.id,
      name: supplierNameById.get(s.id) ?? s.id,
    }))
    .filter((s) => Boolean(s.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const suppliersToRender: CapacityCalendarSupplier[] = supplierId
    ? allSupplierOptions.filter((s) => s.id === supplierId).length > 0
      ? allSupplierOptions.filter((s) => s.id === supplierId)
      : [
          {
            id: supplierId,
            name: supplierNameById.get(supplierId) ?? supplierId,
          },
        ]
    : allSupplierOptions;

  // Optional quick win (lazy): only fetch award feedback when filtered to one supplier.
  if (supplierId && suppliersToRender.length === 1) {
    const feedback = await getAwardFeedbackSummaryForSupplier({
      supplierId,
      lookbackDays: 90,
    });
    const entries = Object.entries(feedback.byReason ?? {})
      .filter(([reason, count]) => typeof reason === "string" && reason.trim() && typeof count === "number")
      .sort((a, b) => {
        const dc = (b[1] ?? 0) - (a[1] ?? 0);
        if (dc !== 0) return dc;
        return a[0].localeCompare(b[0]);
      });
    const top = entries.length > 0 ? entries[0] : null;
    const topReason = top ? top[0] : null;
    const topCount = top ? top[1] : 0;
    const label =
      topReason ? formatAwardFeedbackReasonLabel(topReason) ?? topReason.replace(/[_-]+/g, " ") : null;
    const topWinReason90d = label ? `${label} (${topCount})` : null;
    suppliersToRender[0] = { ...suppliersToRender[0], topWinReason90d };
  }

  const sortedCapabilities = Array.from(capabilitiesInRange).sort((a, b) => a.localeCompare(b));
  const normalizedSelectedCapability = capability?.trim().toLowerCase() ?? null;
  if (normalizedSelectedCapability && !capabilitiesInRange.has(normalizedSelectedCapability)) {
    sortedCapabilities.unshift(normalizedSelectedCapability);
  }

  const startYmd = ymdFromUtcDate(startWeek);
  const prevStartYmd = ymdFromUtcDate(addUtcDays(startWeek, -28));
  const nextStartYmd = ymdFromUtcDate(addUtcDays(startWeek, 28));
  const todayStartYmd = ymdFromUtcDate(defaultStart);

  return (
    <AdminDashboardShell
      title="Capacity Calendar"
      description="Weekly supplier capacity snapshots (advisory-only)."
      actions={
        <div className="flex items-center gap-2">
          <Link
            href={buildHref("/admin/capacity", { start: prevStartYmd, supplierId, capability })}
            className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 hover:border-slate-700"
          >
            ← Prev
          </Link>
          <Link
            href={buildHref("/admin/capacity", { start: todayStartYmd, supplierId, capability })}
            className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 hover:border-slate-700"
          >
            Today
          </Link>
          <Link
            href={buildHref("/admin/capacity", { start: nextStartYmd, supplierId, capability })}
            className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 hover:border-slate-700"
          >
            Next →
          </Link>
        </div>
      }
    >
      {!snapshotsResult.ok ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/30 px-6 py-4 text-sm text-red-100">
          {snapshotsResult.error ?? "We had trouble loading capacity snapshots. Check logs and try again."}
        </div>
      ) : null}
      {!suppliersResult.ok ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 px-6 py-4 text-sm text-amber-100">
          {suppliersResult.error ?? "We had trouble loading suppliers. Filters may be incomplete."}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">4-week range</div>
            <div className="mt-1 text-sm text-slate-400">
              {startYmd} → {ymdFromUtcDate(endWeek)}
            </div>
          </div>

          <form method="GET" action="/admin/capacity" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="start" value={startYmd} />

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Supplier
              </span>
              <select
                name="supplierId"
                defaultValue={supplierId ?? ""}
                className="w-full min-w-64 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="">All suppliers</option>
                {allSupplierOptions.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Capability
              </span>
              <select
                name="capability"
                defaultValue={capability ?? ""}
                className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="">All capabilities</option>
                {sortedCapabilities.map((cap) => (
                  <option key={cap} value={cap}>
                    {cap}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
            >
              Apply
            </button>
          </form>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Bars map to 4 discrete levels (unavailable/overloaded → empty, low → 1/3, medium → 2/3, high → full). Hover a bar for “Last updated”.
        </div>
      </section>

      <CapacityCalendar
        weeks={weeks}
        suppliers={suppliersToRender}
        snapshots={snapshots}
        capabilities={sortedCapabilities}
        capabilityFilter={capability}
      />
    </AdminDashboardShell>
  );
}

