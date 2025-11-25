import { formatDateTime } from "@/lib/formatDate";
import { getCurrentSession } from "@/server/auth";
import { listOpenRfqsForSupplier } from "@/server/marketplace/rfqs";
import { loadSupplierProfile } from "@/server/suppliers/profile";
import { PortalLoginPanel } from "../../PortalLoginPanel";
import PortalCard from "../../PortalCard";
import { EmptyStateNotice } from "../../EmptyStateNotice";
import { SubmitBidForm } from "./SubmitBidForm";

export const dynamic = "force-dynamic";

export default async function SupplierMarketplacePage() {
  const session = await getCurrentSession();
  if (!session) {
    return (
      <PortalLoginPanel
        role="supplier"
        fallbackRedirect="/supplier/marketplace"
      />
    );
  }

  const supplierEmail = session.user.email ?? "";
  const profile = supplierEmail ? await loadSupplierProfile(supplierEmail) : null;
  const supplier = profile?.supplier ?? null;

  if (!supplier) {
    return (
      <PortalCard
        title="Marketplace access locked"
        description="Finish supplier onboarding to see live marketplace RFQs."
        action={
          <a
            href="/supplier/onboarding"
            className="inline-flex rounded-full border border-blue-400 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-blue-200 hover:border-blue-200"
          >
            Complete onboarding
          </a>
        }
      >
        <p className="text-sm text-slate-400">
          We’ll unlock matches and bidding as soon as your profile lists capabilities, certifications, and a verified contact.
        </p>
      </PortalCard>
    );
  }

  const { rfqs, error } = await listOpenRfqsForSupplier(supplier.id);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-300">
          Supplier marketplace
        </p>
        <div className="mt-2 space-y-1">
          <h1 className="text-2xl font-semibold text-white">Open jobs</h1>
          <p className="text-sm text-slate-400">
            Review live RFQs and drop quick bids straight from this page.
          </p>
        </div>
      </section>

      {error ? (
        <PortalCard
          title="Unable to load RFQs"
          description="We ran into an issue while loading marketplace data."
        >
          <p className="text-sm text-red-200">{error}</p>
        </PortalCard>
      ) : null}

      <PortalCard
        title="Available RFQs"
        description="Verified customer jobs are listed newest first."
      >
        {rfqs.length === 0 ? (
          <EmptyStateNotice
            title="No open RFQs right now"
            description="We’ll surface matching jobs here the moment customers publish them."
          />
        ) : (
          <ul className="space-y-4">
            {rfqs.map((rfq) => {
              const processes = toStringArray(rfq.target_processes);
              const materials = toStringArray(rfq.target_materials);
              const myBid = rfq.myBid ?? null;
              return (
                <li
                  key={rfq.id}
                  className="rounded-2xl border border-slate-900/70 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={rfq.status} />
                        <span className="text-xs font-semibold text-slate-400">
                          Posted {formatPostedDate(rfq.created_at)}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">
                          {rfq.bidCount} bid{rfq.bidCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <h2 className="text-lg font-semibold text-white">{rfq.title}</h2>
                      <p className="text-sm text-slate-300">{rfq.description}</p>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                        {processes.length > 0 ? (
                          <span>Processes: {processes.join(", ")}</span>
                        ) : null}
                        {materials.length > 0 ? (
                          <span>Materials: {materials.join(", ")}</span>
                        ) : null}
                        {typeof rfq.lead_time_days === "number" ? (
                          <span>Target lead time: {rfq.lead_time_days} days</span>
                        ) : null}
                        {rfq.budget_amount ? (
                          <span>
                            Budget: {formatCurrency(rfq.budget_amount, rfq.budget_currency)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {myBid ? (
                      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                        <p className="font-semibold uppercase tracking-wide">
                          You submitted a bid
                        </p>
                        <p className="text-sm">
                          {formatCurrency(myBid.price_total, myBid.currency)} ·{" "}
                          {myBid.lead_time_days ?? "Lead pending"} days
                        </p>
                        <p className="text-[11px] text-blue-200/70">
                          Status: {myBid.status}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-900/70 bg-slate-950/60 p-4">
                    <p className="text-sm font-semibold text-white">
                      {myBid ? "Update your bid" : "Send a bid"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Customers see your company name and notes alongside the numbers you submit here.
                    </p>
                    <div className="mt-3">
                      <SubmitBidForm
                        rfqId={rfq.id}
                        defaultPrice={
                          typeof myBid?.price_total === "number" ? myBid.price_total : null
                        }
                        defaultLeadTime={
                          typeof myBid?.lead_time_days === "number"
                            ? myBid.lead_time_days
                            : null
                        }
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PortalCard>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    open: "bg-blue-500/20 text-blue-100 border-blue-500/30",
    draft: "bg-slate-500/20 text-slate-100 border-slate-500/30",
    awarded: "bg-emerald-500/20 text-emerald-100 border-emerald-500/30",
    closed: "bg-slate-600/20 text-slate-200 border-slate-600/30",
    cancelled: "bg-red-500/20 text-red-100 border-red-500/30",
  };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const classes =
    colorMap[status] ??
    "bg-slate-500/20 text-slate-100 border-slate-500/30";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  );
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function formatPostedDate(value: string | null) {
  if (!value) {
    return "recently";
  }
  return formatDateTime(value, { includeTime: false }) ?? "recently";
}

function formatCurrency(
  value: number | string | null | undefined,
  currency?: string | null,
) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return "Budget pending";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency ?? "USD").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `$${numeric.toFixed(0)}`;
  }
}
