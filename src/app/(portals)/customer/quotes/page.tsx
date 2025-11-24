import PortalCard from "../../PortalCard";
import { requireSession } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function CustomerQuotesPlaceholder() {
  await requireSession({ redirectTo: "/customer" });

  return (
    <PortalCard
      title="Quotes workspace"
      description="Track RFQs and documents in one place."
    >
      <p className="text-sm text-slate-400">This section is coming soon.</p>
    </PortalCard>
  );
}
