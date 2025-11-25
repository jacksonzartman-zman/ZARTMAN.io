import { formatDateTime } from "@/lib/formatDate";
import { requireSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import {
  listRfqsForCustomer,
  type RfqWithStats,
} from "@/server/marketplace/rfqs";
import { EmptyStateNotice } from "../../EmptyStateNotice";
import PortalCard from "../../PortalCard";
import { NewCustomerRfqForm } from "./NewCustomerRfqForm";

export const dynamic = "force-dynamic";

export default async function CustomerRfqsPage() {
  const session = await requireSession({ redirectTo: "/customer/rfqs" });
  const customer = await getCustomerByUserId(session.user.id);

  if (!customer) {
    return (
      <PortalCard
        title="Finish onboarding"
        description="Complete your customer profile on /customer to start posting marketplace RFQs."
      >
        <p className="text-sm text-slate-400">
          Once your profile is set up, you can create RFQs from this workspace and invite suppliers to bid.
        </p>
      </PortalCard>
    );
  }

  const { rfqs, error } = await listRfqsForCustomer(customer.id);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
          Customer RFQs
        </p>
        <div className="mt-2 space-y-1">
          <h1 className="text-2xl font-semibold text-white">Jobs & RFQs</h1>
          <p className="text-sm text-slate-400">
            Publish work for the supplier marketplace and track responses in real time.
          </p>
        </div>
      </section>

      <PortalCard
        title="Create a new RFQ"
        description="Share enough detail for vetted shops to respond quickly. File uploads are coming soon—add a placeholder label for now."
      >
        <NewCustomerRfqForm />
      </PortalCard>

      <PortalCard
        title="Your RFQs"
        description="Latest RFQs submitted from this workspace."
      >
        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </p>
        ) : rfqs.length === 0 ? (
          <EmptyStateNotice
            title="No RFQs yet"
            description="Post your first RFQ above to unlock the supplier marketplace."
          />
        ) : (
          <ul className="space-y-3">
            {rfqs.map((rfq) => (
              <li
                key={rfq.id}
                className="rounded-2xl border border-slate-900/70 bg-slate-950/40 px-4 py-3"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{rfq.title}</p>
                    <p className="text-xs text-slate-400 line-clamp-2">
                      {rfq.description}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right text-xs text-slate-400">
                    <StatusBadge status={rfq.status} />
                    <p>{formatRelativeDate(rfq.created_at)}</p>
                    <p>{rfq.bidCount} bid{rfq.bidCount === 1 ? "" : "s"}</p>
                    {rfq.acceptedBidId ? (
                      <p className="font-semibold text-emerald-200">Bid awarded</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PortalCard>
    </div>
  );
}

function StatusBadge({ status }: { status: RfqWithStats["status"] }) {
  const labelMap: Record<RfqWithStats["status"], string> = {
    draft: "Draft",
    open: "Open",
    closed: "Closed",
    awarded: "Awarded",
    cancelled: "Cancelled",
  };
  const colorMap: Record<RfqWithStats["status"], string> = {
    draft: "bg-slate-500/20 text-slate-200 border-slate-500/30",
    open: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    closed: "bg-slate-600/20 text-slate-200 border-slate-600/30",
    awarded: "bg-amber-500/20 text-amber-200 border-amber-500/30",
    cancelled: "bg-red-500/20 text-red-200 border-red-500/30",
  };

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${colorMap[status]}`}>
      {labelMap[status]}
    </span>
  );
}

function formatRelativeDate(value: string | null) {
  if (!value) {
    return "Just now";
  }
  return formatDateTime(value, { includeTime: false }) ?? "Date pending";
}
