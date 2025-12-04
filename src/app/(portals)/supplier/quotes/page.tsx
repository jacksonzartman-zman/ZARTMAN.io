import Link from "next/link";
import PortalCard from "../../PortalCard";
import { PortalShell } from "../../components/PortalShell";
import { requireUser } from "@/server/auth";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  getSupplierApprovalStatus,
  loadSupplierProfile,
  type SupplierApprovalStatus,
} from "@/server/suppliers";
import { approvalsEnabled } from "@/server/suppliers/flags";

export const dynamic = "force-dynamic";

export default async function SupplierQuotesLanding() {
  const user = await requireUser({ redirectTo: "/supplier" });
  const supplierEmail = normalizeEmailInput(user.email ?? null);
  const approvalsOn = approvalsEnabled();
  let approvalStatus: SupplierApprovalStatus = "unknown";

  if (approvalsOn && supplierEmail) {
    const profile = await loadSupplierProfile(supplierEmail);
    approvalStatus =
      profile?.approvalStatus ??
      getSupplierApprovalStatus(profile?.supplier ?? undefined);
  }

  const approvalGateActive = approvalsOn && approvalStatus !== "approved";
  const headerActions = (
    <Link
      href="/supplier"
      className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
    >
      Back to dashboard
    </Link>
  );

  return (
    <PortalShell
      workspace="supplier"
      title="Quotes"
      subtitle="Matched RFQs and bid workspaces will appear here soon."
      actions={headerActions}
    >
      <PortalCard
        title="Inbound RFQs"
        description="We’ll list matched work here once the module ships."
      >
        {approvalGateActive ? (
          <p className="text-sm text-amber-100">
            RFQs and bids will appear here once your account is approved.
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            This section is coming soon. Keep your profile current and watch your dashboard for RFQ
            assignments in the meantime.
          </p>
        )}
      </PortalCard>
    </PortalShell>
  );
}
