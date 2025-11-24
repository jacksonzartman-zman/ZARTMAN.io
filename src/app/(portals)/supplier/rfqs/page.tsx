import PortalCard from "../../PortalCard";
import { requireSession } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function SupplierRfqsPlaceholder() {
  await requireSession({ redirectTo: "/supplier" });

  return (
    <PortalCard
      title="Inbound RFQs"
      description="We’ll list matched work here once the module ships."
    >
      <p className="text-sm text-slate-400">This section is coming soon.</p>
    </PortalCard>
  );
}
