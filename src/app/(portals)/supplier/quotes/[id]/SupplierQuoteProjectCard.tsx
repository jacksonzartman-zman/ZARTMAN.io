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

  return (
    <section className={clsx(className, "space-y-3")}>
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Project kickoff
        </p>
        <h2 className="text-lg font-semibold text-white">PO details from Zartman</h2>
        <p className="text-sm text-slate-300">
          Visibility into the customer’s PO number and target ship date once the quote is
          awarded.
        </p>
      </header>

      {unavailable ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
          Project details are temporarily unavailable.
        </p>
      ) : null}

      <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
        <SummaryItem label="PO number" value={poNumber ?? "Pending"} />
        <SummaryItem label="Target ship date" value={targetShipDate ?? "Not set"} />
      </dl>

    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-100">{value}</dd>
    </div>
  );
}
