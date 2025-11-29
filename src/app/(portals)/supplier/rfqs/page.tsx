import PortalCard from "../../PortalCard";
import { requireUser } from "@/server/auth";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  getSupplierApprovalStatus,
  loadSupplierProfile,
  type SupplierApprovalStatus,
} from "@/server/suppliers";
import { approvalsEnabled } from "@/server/suppliers/flags";

export const dynamic = "force-dynamic";

export default async function SupplierRfqsPlaceholder() {
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

  return (
    <PortalCard
      title="Inbound RFQs"
      description="We’ll list matched work here once the module ships."
    >
      {approvalGateActive ? (
        <p className="text-sm text-amber-100">
          RFQs and bids will appear here once your account is approved.
        </p>
      ) : (
        <p className="text-sm text-slate-400">This section is coming soon.</p>
      )}
    </PortalCard>
  );
}
