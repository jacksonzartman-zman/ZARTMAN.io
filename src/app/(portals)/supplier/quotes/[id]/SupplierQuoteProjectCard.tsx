import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import type { QuoteProjectRecord } from "@/server/quotes/projects";

type SupplierQuoteProjectCardProps = {
  project: QuoteProjectRecord | null;
  unavailable?: boolean;
  className?: string;
  winningBidAmountLabel?: string;
  winningBidLeadTimeLabel?: string;
};

export function SupplierQuoteProjectCard({
  project,
  unavailable = false,
  className,
  winningBidAmountLabel = "Pricing pending",
  winningBidLeadTimeLabel = "Lead time pending",
}: SupplierQuoteProjectCardProps) {
  const poNumber = project?.po_number?.trim();
  const targetShipDate = project?.target_ship_date
    ? formatDateTime(project.target_ship_date) ?? project.target_ship_date
    : null;
  const projectCreatedAt = project?.created_at
    ? formatDateTime(project.created_at, { includeTime: true }) ?? project.created_at
    : null;
  const projectStatus = formatProjectStatus(project?.status);
  const showEmptyState = !project && !unavailable;

  return (
    <section className={clsx(className, "space-y-4")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Project kickoff
          </p>
          <h2 className="text-lg font-semibold text-white">Project kickoff snapshot</h2>
          <p className="text-sm text-slate-300">
            Kickoff checklist below tracks your prep before PO release.
          </p>
        </div>
        <span
          className={clsx(
            "rounded-full border px-4 py-1 text-xs font-semibold tracking-wide",
            projectStatus.pillClasses,
          )}
        >
          {projectStatus.label}
        </span>
      </header>

      {unavailable ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
          Project details are temporarily unavailable.
        </p>
      ) : showEmptyState ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-sm text-slate-300">
          The customer hasn't provided kickoff details yet. We&apos;ll notify you when the PO number and ship
          date are ready.
        </p>
      ) : null}

      {project ? (
        <>
          <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
            <SummaryItem
              label="Project created"
              value={projectCreatedAt ?? "Awaiting kickoff"}
            />
            <SummaryItem label="Winning bid" value={winningBidAmountLabel} />
            <SummaryItem label="Lead time" value={winningBidLeadTimeLabel} />
          </dl>
          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 p-4 text-sm text-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Kickoff reminder
            </p>
            <p className="mt-1 text-slate-200">
              Lock materials, confirm tooling, and keep the checklist updated as you prep for the PO.
            </p>
          </div>
        </>
      ) : null}

      <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
        <SummaryItem
          label="PO number"
          value={poNumber ?? null}
          placeholder="Pending"
        />
        <SummaryItem
          label="Target ship date"
          value={targetShipDate ?? null}
          placeholder="Not set"
        />
        <SummaryItem
          label="Kickoff notes"
          value={project?.notes ?? null}
          placeholder="No kickoff notes yet."
          multiline
          className="sm:col-span-2"
        />
      </dl>
    </section>
  );
}

function formatProjectStatus(status?: string | null): {
  label: string;
  pillClasses: string;
} {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  switch (normalized) {
    case "kickoff":
    case "in_progress":
    case "in-progress":
      return {
        label: "Kickoff in progress",
        pillClasses: "border-blue-500/40 bg-blue-500/10 text-blue-100",
      };
    case "production":
    case "in_production":
      return {
        label: "In production",
        pillClasses: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      };
    default:
      return {
        label: "Active project",
        pillClasses: "border-slate-700 bg-slate-900/40 text-slate-200",
      };
  }
}

function SummaryItem({
  label,
  value,
  placeholder = "—",
  multiline = false,
  className = "",
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const display =
    typeof value === "string" && value.trim().length > 0 ? value : placeholder;
  const valueClasses = [
    multiline ? "whitespace-pre-line text-sm font-normal" : "font-medium",
    "text-slate-100",
  ].join(" ");
  return (
    <div
      className={`rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2 ${className}`.trim()}
    >
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={valueClasses}>{display}</dd>
    </div>
  );
}
