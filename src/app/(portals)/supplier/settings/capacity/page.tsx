import Link from "next/link";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers/profile";
import {
  loadSupplierCapacitySnapshotsForWeek,
} from "@/server/suppliers/capacity";
import {
  SupplierCapacityEditor,
  type SupplierCapacityEditorValues,
} from "@/app/(portals)/supplier/components/SupplierCapacityEditor";

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
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
            Supplier workspace
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Capacity</h1>
          <p className="mt-2 text-sm text-slate-400">
            Finish supplier onboarding to manage capacity snapshots.
          </p>
          <div className="mt-4">
            <Link
              href="/supplier/onboarding"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              Complete onboarding
            </Link>
          </div>
        </section>
      </div>
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
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
          Supplier workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Capacity</h1>
        <p className="mt-2 text-sm text-slate-400">
          Share weekly capacity snapshots so the Zartman team can plan timelines across quotes.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Week</h2>
          <p className="mt-1 text-sm text-slate-400">
            Choose a week to view or update your saved snapshot.
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Week starting (Monday)
            </span>
            <select
              name="week"
              defaultValue={selectedWeekStartDate}
              className="w-full min-w-[16rem] rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-white"
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
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Weekly snapshot</h2>
          <p className="mt-1 text-sm text-slate-400">
            Save levels for the selected week. Leave “Not set” to keep a capability unset.
          </p>
        </div>
        <SupplierCapacityEditor
          weekStartDate={selectedWeekStartDate}
          initialValues={initialValues}
        />
      </section>
    </div>
  );
}

function normalizeWeekStartDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function getNextWeekStartDateIso(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0..6 (Sun..Sat)
  const daysUntilNextMonday = ((8 - day) % 7) || 7;
  const nextMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilNextMonday),
  );
  return nextMonday.toISOString().slice(0, 10);
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

