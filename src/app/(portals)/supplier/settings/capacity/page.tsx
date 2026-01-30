import Link from "next/link";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers/profile";
import {
  loadSupplierCapacitySnapshotsForWeek,
  loadLatestCapacityUpdateRequestForSupplierWeek,
} from "@/server/suppliers/capacity";
import {
  SupplierCapacityEditor,
  type SupplierCapacityEditorValues,
} from "@/app/(portals)/supplier/components/SupplierCapacityEditor";
import { getNextWeekStartDateIso } from "@/lib/dates/weekStart";

export const dynamic = "force-dynamic";

type SupplierCapacitySettingsPageProps = {
  searchParams?: Promise<{ week?: string | string[] }>;
};

export default async function SupplierCapacitySettingsPage({
  searchParams,
}: SupplierCapacitySettingsPageProps) {
  const user = await requireUser({ redirectTo: "/supplier/settings/capacity" });
  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;

  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Capacity"
        subtitle="Share weekly capacity snapshots so timelines stay accurate."
        actions={
          <Link
            href="/supplier/settings"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
          >
            Back to settings
          </Link>
        }
      >
        <PortalCard
          title="Finish onboarding"
          description="Complete onboarding before managing capacity snapshots."
        >
          <Link
            href="/supplier/onboarding"
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            Complete onboarding
          </Link>
        </PortalCard>
      </PortalShell>
    );
  }

  const resolved = searchParams ? await searchParams : undefined;
  const requestedWeek =
    typeof resolved?.week === "string"
      ? resolved.week
      : Array.isArray(resolved?.week)
        ? resolved.week[0]
        : "";

  const nextWeekStartDate = getNextWeekStartDateIso();
  const selectedWeekStartDate = normalizeWeekStartDate(requestedWeek) || nextWeekStartDate;
  const weekOptions = buildWeekOptions(nextWeekStartDate, 5);

  const snapshotsResult = await loadSupplierCapacitySnapshotsForWeek({
    supplierId: supplier.id,
    weekStartDate: selectedWeekStartDate,
  });

  const nextWeekSnapshotsResult =
    selectedWeekStartDate === nextWeekStartDate
      ? snapshotsResult
      : await loadSupplierCapacitySnapshotsForWeek({
          supplierId: supplier.id,
          weekStartDate: nextWeekStartDate,
        });

  const latestRequest = await loadLatestCapacityUpdateRequestForSupplierWeek({
    supplierId: supplier.id,
    weekStartDate: nextWeekStartDate,
  });

  const capacityUniverse = ["cnc_mill", "cnc_lathe", "mjp", "sla"] as const;
  const universeSet = new Set<string>(capacityUniverse);
  const nextWeekSnapshots = nextWeekSnapshotsResult.ok ? nextWeekSnapshotsResult.snapshots : [];
  const coverage = new Set<string>();
  let lastUpdatedAt: string | null = null;
  let lastUpdatedMs = Number.NEGATIVE_INFINITY;

  for (const snapshot of nextWeekSnapshots) {
    const capability = typeof snapshot.capability === "string" ? snapshot.capability : "";
    if (universeSet.has(capability)) {
      coverage.add(capability);
    }
    if (typeof snapshot.createdAt === "string") {
      const ms = Date.parse(snapshot.createdAt);
      if (Number.isFinite(ms) && ms > lastUpdatedMs) {
        lastUpdatedMs = ms;
        lastUpdatedAt = snapshot.createdAt;
      }
    }
  }

  const coverageCount = coverage.size;
  const requestCreatedAt = typeof latestRequest?.createdAt === "string" ? latestRequest.createdAt : null;
  const requestMs = requestCreatedAt ? Date.parse(requestCreatedAt) : Number.NaN;
  const staleMsThreshold = 14 * 24 * 60 * 60 * 1000;
  const isOlderThan14Days =
    Boolean(lastUpdatedAt) &&
    Number.isFinite(lastUpdatedMs) &&
    Date.now() - lastUpdatedMs > staleMsThreshold;
  const hasNewerRequest =
    Boolean(requestCreatedAt) &&
    (lastUpdatedAt === null ||
      (Number.isFinite(requestMs) && Number.isFinite(lastUpdatedMs) && requestMs > lastUpdatedMs));

  const showBanner =
    coverageCount < 2 || lastUpdatedAt === null || isOlderThan14Days || hasNewerRequest;

  const initialValues: SupplierCapacityEditorValues = {};
  if (snapshotsResult.ok) {
    for (const snapshot of snapshotsResult.snapshots) {
      if (
        snapshot.capability === "cnc_mill" ||
        snapshot.capability === "cnc_lathe" ||
        snapshot.capability === "mjp" ||
        snapshot.capability === "sla"
      ) {
        initialValues[snapshot.capability] = {
          level: snapshot.capacityLevel,
          notes: snapshot.notes,
        };
      }
    }
  }

  return (
    <PortalShell
      workspace="supplier"
      title="Capacity"
      subtitle="Share weekly capacity snapshots so the Zartman team can plan timelines across quotes."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/supplier/settings"
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            Back to settings
          </Link>
          <Link
            href="/supplier"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
          >
            Dashboard
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <PortalCard
          title="Week"
          description="Choose a week to view or update your saved snapshot."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Week starting (Monday)
              </span>
              <select
                name="week"
                defaultValue={selectedWeekStartDate}
                className="w-full min-w-[16rem] rounded-xl bg-slate-950/35 px-3 py-2.5 text-sm text-slate-100 ring-1 ring-slate-800/50"
              >
                {weekOptions.map((week) => (
                  <option key={week} value={week}>
                    {formatWeekLabel(week, nextWeekStartDate)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-full border border-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-700 hover:text-white"
            >
              Load week
            </button>
          </form>
        </PortalCard>

        <PortalCard
          title="Weekly snapshot"
          description='Save levels for the selected week. Leave “Not set” to keep a capability unset.'
        >
          <div className="space-y-4">
            {showBanner ? (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-100">
                <p className="font-semibold">
                  Your capacity for next week is missing or stale. Keeping this updated improves quote routing.
                </p>
                {hasNewerRequest ? (
                  <p className="mt-1 text-xs text-yellow-100/80">
                    An admin requested a capacity update.
                  </p>
                ) : null}
              </div>
            ) : null}
            <SupplierCapacityEditor
              weekStartDate={selectedWeekStartDate}
              initialValues={initialValues}
            />
          </div>
        </PortalCard>
      </div>
    </PortalShell>
  );
}

function normalizeWeekStartDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function buildWeekOptions(nextWeekStartDateIso: string, count: number): string[] {
  const parsed = Date.parse(`${nextWeekStartDateIso}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return [nextWeekStartDateIso];
  const options: string[] = [];
  const base = new Date(parsed);
  for (let i = 0; i < Math.max(1, count); i += 1) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + i * 7));
    options.push(d.toISOString().slice(0, 10));
  }
  return options;
}

function formatWeekLabel(weekStartDateIso: string, nextWeekStartDateIso: string): string {
  if (weekStartDateIso === nextWeekStartDateIso) {
    return `Next week (${weekStartDateIso})`;
  }
  return weekStartDateIso;
}

