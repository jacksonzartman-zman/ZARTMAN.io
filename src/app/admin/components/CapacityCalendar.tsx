import clsx from "clsx";

export type CapacityCalendarWeek = {
  weekStartDate: string; // YYYY-MM-DD
  label: string;
};

export type CapacityCalendarSnapshot = {
  supplierId: string;
  supplierName: string;
  weekStartDate: string; // YYYY-MM-DD
  capability: string;
  capacityLevel: string;
  createdAt: string | null;
};

export type CapacityCalendarSupplier = {
  id: string;
  name: string;
};

function formatLastUpdated(createdAt: string | null): string {
  if (!createdAt) return "Last updated: unknown";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Last updated: unknown";
  return `Last updated: ${date.toLocaleString()}`;
}

function capacityToFill(level: string): 0 | 1 | 2 | 3 {
  const normalized = (level ?? "").toString().trim().toLowerCase();
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  if (normalized === "low") return 1;
  // Treat both "overloaded" (DB) and "unavailable" (UI spec) as empty/blocked.
  if (normalized === "overloaded" || normalized === "unavailable") return 0;
  return 0;
}

function capabilityLabel(capability: string): string {
  const key = (capability ?? "").toString().trim();
  if (!key) return "Unknown";
  // Humanize snake_case keys (cnc_mill -> CNC Mill).
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
}

function buildSnapshotIndex(snapshots: CapacityCalendarSnapshot[]) {
  const bySupplier = new Map<string, Map<string, CapacityCalendarSnapshot[]>>();
  for (const snapshot of snapshots) {
    const supplierId = snapshot.supplierId;
    const week = snapshot.weekStartDate;
    if (!supplierId || !week) continue;

    let byWeek = bySupplier.get(supplierId);
    if (!byWeek) {
      byWeek = new Map<string, CapacityCalendarSnapshot[]>();
      bySupplier.set(supplierId, byWeek);
    }

    const list = byWeek.get(week) ?? [];
    list.push(snapshot);
    byWeek.set(week, list);
  }

  // Stable ordering within each cell.
  for (const byWeek of bySupplier.values()) {
    for (const [week, list] of byWeek.entries()) {
      list.sort((a, b) => a.capability.localeCompare(b.capability));
      byWeek.set(week, list);
    }
  }

  return bySupplier;
}

export default function CapacityCalendar({
  weeks,
  suppliers,
  snapshots,
  capabilityFilter,
}: {
  weeks: CapacityCalendarWeek[];
  suppliers: CapacityCalendarSupplier[];
  snapshots: CapacityCalendarSnapshot[];
  capabilityFilter?: string | null;
}) {
  const snapshotIndex = buildSnapshotIndex(snapshots);
  const normalizedCapabilityFilter =
    typeof capabilityFilter === "string" && capabilityFilter.trim().length > 0
      ? capabilityFilter.trim().toLowerCase()
      : null;

  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-900/60 bg-slate-950/30">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[280px_repeat(4,1fr)] border-b border-slate-900/60">
          <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Supplier
          </div>
          {weeks.map((week) => (
            <div
              key={week.weekStartDate}
              className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400"
            >
              {week.label}
              <div className="mt-1 text-[11px] font-medium text-slate-500">
                {week.weekStartDate}
              </div>
            </div>
          ))}
        </div>

        <div className="divide-y divide-slate-900/60">
          {suppliers.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-400">
              No suppliers found for this range.
            </div>
          ) : null}

          {suppliers.map((supplier) => {
            const byWeek = snapshotIndex.get(supplier.id) ?? new Map<string, CapacityCalendarSnapshot[]>();

            return (
              <div
                key={supplier.id}
                className="grid grid-cols-[280px_repeat(4,1fr)]"
              >
                <div className="px-4 py-4">
                  <div className="text-sm font-semibold text-slate-100">
                    {supplier.name}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{supplier.id}</div>
                </div>

                {weeks.map((week) => {
                  const cellSnapshots = byWeek.get(week.weekStartDate) ?? [];
                  const filtered =
                    normalizedCapabilityFilter
                      ? cellSnapshots.filter(
                          (s) => s.capability.trim().toLowerCase() === normalizedCapabilityFilter,
                        )
                      : cellSnapshots;

                  return (
                    <div
                      key={`${supplier.id}:${week.weekStartDate}`}
                      className="px-4 py-4"
                    >
                      {filtered.length === 0 ? (
                        <div className="text-xs text-slate-600">—</div>
                      ) : (
                        <div className="space-y-2">
                          {filtered.map((snapshot) => {
                            const fill = capacityToFill(snapshot.capacityLevel);
                            const widthPct = Math.round((fill / 3) * 100);
                            const title = [
                              `${capabilityLabel(snapshot.capability)}: ${snapshot.capacityLevel}`,
                              formatLastUpdated(snapshot.createdAt),
                            ].join("\n");

                            return (
                              <div
                                key={`${snapshot.weekStartDate}:${snapshot.capability}`}
                                className="flex items-center gap-2"
                              >
                                <div className="w-28 truncate text-[11px] font-medium text-slate-400">
                                  {capabilityLabel(snapshot.capability)}
                                </div>
                                <div
                                  className="flex-1"
                                  title={title}
                                  aria-label={title}
                                >
                                  <div className="h-2 w-full overflow-hidden rounded-full border border-slate-800 bg-slate-950/40">
                                    <div
                                      className={clsx(
                                        "h-full rounded-full bg-slate-200",
                                        fill === 0 ? "opacity-20" : fill === 1 ? "opacity-40" : fill === 2 ? "opacity-70" : "opacity-95",
                                      )}
                                      style={{ width: `${widthPct}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

