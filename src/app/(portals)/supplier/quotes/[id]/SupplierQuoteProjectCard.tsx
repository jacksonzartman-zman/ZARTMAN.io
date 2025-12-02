import clsx from "clsx";
import { formatDateTime } from "@/lib/formatDate";
import type { QuoteProjectRow } from "@/server/quotes/projects";

type SupplierQuoteProjectCardProps = {
  project: QuoteProjectRow | null;
  unavailable?: boolean;
  className?: string;
};

export function SupplierQuoteProjectCard({
  project,
  unavailable = false,
  className,
}: SupplierQuoteProjectCardProps) {
  const poNumber = project?.po_number?.trim();
  const targetShipDate = project?.target_ship_date
    ? formatDateTime(project.target_ship_date) ?? project.target_ship_date
    : null;
  const showEmptyState = !project && !unavailable;

  return (
    <section className={clsx(className, "space-y-3")}>
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Project kickoff
        </p>
        <h2 className="text-lg font-semibold text-white">PO details & target dates</h2>
        <p className="text-sm text-slate-300">
          Read-only view of the customer’s PO number, target ship date, and kickoff notes once the
          RFQ is awarded.
        </p>
      </header>

      {unavailable ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
          Project details are temporarily unavailable.
        </p>
      ) : showEmptyState ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-sm text-slate-300">
          The customer hasn't provided kickoff details yet. We'll notify you when the PO number and ship
          date are ready.
        </p>
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
