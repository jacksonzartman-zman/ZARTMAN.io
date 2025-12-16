import clsx from "clsx";
import {
  CAPACITY_CAPABILITY_UNIVERSE,
  type CapacityCapability,
  type CapacityLevel,
} from "@/server/admin/capacity";

export type CapacitySummaryLevels = Record<
  CapacityCapability,
  CapacityLevel | string | null | undefined
>;

export function CapacitySummaryPills({
  coverageCount,
  totalCount,
  levels,
  lastUpdatedAt,
  align = "end",
}: {
  coverageCount: number;
  totalCount: number;
  levels: CapacitySummaryLevels;
  lastUpdatedAt: string | null;
  align?: "start" | "end";
}) {
  const coverageLabel = `${coverageCount}/${totalCount} set`;
  const tooltip =
    lastUpdatedAt && lastUpdatedAt.trim().length > 0
      ? `Last updated ${lastUpdatedAt}`
      : "No capacity snapshots saved yet";
  const alignment =
    align === "start"
      ? { outer: "items-start", pills: "justify-start" }
      : { outer: "items-end", pills: "justify-end" };

  return (
    <div className={clsx("inline-flex flex-col gap-2", alignment.outer)} title={tooltip}>
      <span className="inline-flex rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
        {coverageLabel}
      </span>
      <div className={clsx("flex flex-wrap gap-1", alignment.pills)}>
        {CAPACITY_CAPABILITY_UNIVERSE.map((capability) => {
          const level = levels?.[capability] ?? null;
          const label = formatCapacityLevelLabel(level);
          const isSet = Boolean(label);
          return (
            <span
              key={capability}
              title={capability}
              className={clsx(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                isSet
                  ? capacityLevelPillClasses(level)
                  : "border-slate-800 bg-slate-950/40 text-slate-500",
              )}
            >
              {label ?? "—"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function formatCapacityLevelLabel(level: unknown): string | null {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  if (normalized === "unavailable") return "Unavailable";
  if (normalized === "overloaded") return "Overloaded";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function capacityLevelPillClasses(level: unknown): string {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";
  switch (normalized) {
    case "high":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "medium":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "low":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "unavailable":
      return "border-slate-700 bg-slate-900/40 text-slate-200";
    case "overloaded":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-700 bg-slate-900/40 text-slate-200";
  }
}

