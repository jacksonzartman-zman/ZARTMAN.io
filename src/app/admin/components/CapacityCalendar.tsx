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

function parseSnapshotDate(createdAt: string | null): Date | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLastUpdated(createdAt: string | null): string {
  if (!createdAt) return "Last updated: unknown";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Last updated: unknown";
  return `Last updated: ${date.toLocaleString()}`;
}

function formatRelativeTimeFromNow(createdAt: string | null, now: Date = new Date()): string | null {
  const date = parseSnapshotDate(createdAt);
  if (!date) return null;

  const diffMs = date.getTime() - now.getTime();
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);

  // Pick the largest sensible unit for display.
  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (absSeconds < 60) {
    value = diffSeconds;
    unit = "second";
  } else if (absSeconds < 60 * 60) {
    value = Math.round(diffSeconds / 60);
    unit = "minute";
  } else if (absSeconds < 60 * 60 * 24) {
    value = Math.round(diffSeconds / (60 * 60));
    unit = "hour";
  } else if (absSeconds < 60 * 60 * 24 * 14) {
    value = Math.round(diffSeconds / (60 * 60 * 24));
    unit = "day";
  } else if (absSeconds < 60 * 60 * 24 * 60) {
    value = Math.round(diffSeconds / (60 * 60 * 24 * 7));
    unit = "week";
  } else if (absSeconds < 60 * 60 * 24 * 365) {
    value = Math.round(diffSeconds / (60 * 60 * 24 * 30));
    unit = "month";
  } else {
    value = Math.round(diffSeconds / (60 * 60 * 24 * 365));
    unit = "year";
  }

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  return rtf.format(value, unit);
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
  capabilities,
  capabilityFilter,
}: {
  weeks: CapacityCalendarWeek[];
  suppliers: CapacityCalendarSupplier[];
  snapshots: CapacityCalendarSnapshot[];
  capabilities: string[];
  capabilityFilter?: string | null;
}) {
  const snapshotIndex = buildSnapshotIndex(snapshots);
  const now = new Date();

  const normalizedCapabilitiesAll = (capabilities ?? [])
    .map((cap) => (cap ?? "").toString().trim().toLowerCase())
    .filter(Boolean);
  const totalCapabilityCount = normalizedCapabilitiesAll.length;
  const capabilityUniverse = new Set(normalizedCapabilitiesAll);
  const normalizedCapabilityFilter =
    typeof capabilityFilter === "string" && capabilityFilter.trim().length > 0
      ? capabilityFilter.trim().toLowerCase()
      : null;

  const capabilitiesToRender =
    normalizedCapabilityFilter && normalizedCapabilityFilter.length > 0
      ? [normalizedCapabilityFilter]
      : capabilities;

  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-900/60 bg-slate-950/30">
      <div className="min-w-[980px]">
        {suppliers.length > 0 && snapshots.length === 0 ? (
          <div className="border-b border-slate-900/60 px-4 py-4 text-sm text-slate-400">
            No capacity snapshots yet for this range. Suppliers can add capacity in Settings → Capacity.
          </div>
        ) : null}
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
              No suppliers found.
            </div>
          ) : null}

          {suppliers.map((supplier) => {
            const byWeek = snapshotIndex.get(supplier.id) ?? new Map<string, CapacityCalendarSnapshot[]>();
            let lastUpdatedDate: Date | null = null;
            let lastUpdatedAtRaw: string | null = null;
            for (const list of byWeek.values()) {
              for (const snapshot of list) {
                const date = parseSnapshotDate(snapshot.createdAt);
                if (!date) continue;
                if (!lastUpdatedDate || date.getTime() > lastUpdatedDate.getTime()) {
                  lastUpdatedDate = date;
                  lastUpdatedAtRaw = snapshot.createdAt;
                }
              }
            }

            const lastUpdatedRelative = formatRelativeTimeFromNow(lastUpdatedAtRaw, now);
            const isStale =
              lastUpdatedDate ? now.getTime() - lastUpdatedDate.getTime() > 14 * 24 * 60 * 60 * 1000 : false;

            return (
              <div
                key={supplier.id}
                className="grid grid-cols-[280px_repeat(4,1fr)]"
              >
                <div className="px-4 py-4">
                  <div className="text-sm font-semibold text-slate-100">
                    {supplier.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span title={lastUpdatedDate ? lastUpdatedDate.toLocaleString() : "No snapshots in range"}>
                      {lastUpdatedRelative ? `Updated ${lastUpdatedRelative}` : "No updates in range"}
                    </span>
                    {isStale ? (
                      <span className="rounded-full border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                        Stale
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{supplier.id}</div>
                </div>

                {weeks.map((week) => {
                  const cellSnapshots = byWeek.get(week.weekStartDate) ?? [];
                  const coveredCapabilities = new Set<string>();
                  for (const snapshot of cellSnapshots) {
                    const key = snapshot.capability.trim().toLowerCase();
                    if (key && capabilityUniverse.has(key)) coveredCapabilities.add(key);
                  }
                  const coverageCount = coveredCapabilities.size;
                  const coverageText =
                    totalCapabilityCount > 0 ? `${coverageCount}/${totalCapabilityCount} set` : "—";

                  return (
                    <div
                      key={`${supplier.id}:${week.weekStartDate}`}
                      className="px-4 py-4"
                    >
                      <div className="mb-2 text-[11px] font-medium text-slate-500">{coverageText}</div>
                      <div className="space-y-2">
                        {(capabilitiesToRender.length > 0 ? capabilitiesToRender : [""]).map((capabilityKey) => {
                          const normalizedKey = capabilityKey.trim().toLowerCase();
                          const matchingSnapshot =
                            normalizedKey.length > 0
                              ? cellSnapshots.find(
                                  (s) => s.capability.trim().toLowerCase() === normalizedKey,
                                ) ?? null
                              : null;

                          const isPlaceholder = matchingSnapshot === null;
                          const fill = matchingSnapshot ? capacityToFill(matchingSnapshot.capacityLevel) : 0;
                          const widthPct = matchingSnapshot ? Math.round((fill / 3) * 100) : 100;
                          const label = capabilityLabel(
                            matchingSnapshot?.capability ?? (normalizedKey.length > 0 ? normalizedKey : "—"),
                          );
                          const title = matchingSnapshot
                            ? [
                                `${capabilityLabel(matchingSnapshot.capability)}: ${matchingSnapshot.capacityLevel}`,
                                formatLastUpdated(matchingSnapshot.createdAt),
                              ].join("\n")
                            : `${label}: no snapshot yet`;

                          return (
                            <div
                              key={`${week.weekStartDate}:${normalizedKey || "placeholder"}`}
                              className="flex items-center gap-2"
                            >
                              <div className="w-28 truncate text-[11px] font-medium text-slate-400">
                                {label}
                              </div>
                              <div
                                className="flex-1"
                                title={title}
                                aria-label={title}
                              >
                                <div className="h-2 w-full overflow-hidden rounded-full border border-slate-800 bg-slate-950/40">
                                  <div
                                    className={clsx(
                                      "h-full rounded-full",
                                      isPlaceholder
                                        ? "border border-dashed border-slate-700/70 bg-transparent opacity-80"
                                        : clsx(
                                            "bg-slate-200",
                                            fill === 0
                                              ? "opacity-20"
                                              : fill === 1
                                                ? "opacity-40"
                                                : fill === 2
                                                  ? "opacity-70"
                                                  : "opacity-95",
                                          ),
                                    )}
                                    style={{ width: `${isPlaceholder ? 100 : widthPct}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
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

