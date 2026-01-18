export const dynamic = "force-dynamic";

import Link from "next/link";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import { requireUser } from "@/server/auth";

export default async function CustomerSearchPage() {
  await requireUser({ redirectTo: "/customer/search" });

  return (
    <PortalShell
      workspace="customer"
      title="Search manufacturing options"
      subtitle="Compare pricing and lead times across providers."
      actions={
        <>
          <Link href="/quote" className={primaryCtaClasses}>
            Start a search
          </Link>
          <Link href="/customer/quotes" className={secondaryCtaClasses}>
            View quote history
          </Link>
        </>
      }
    >
      <PortalCard
        title="Start from your RFQ"
        description="Upload a CAD pack and we will match you to the right providers."
      >
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>Share your parts, quantities, and deadlines in one place.</li>
          <li>We route the RFQ to qualified suppliers for pricing and lead times.</li>
          <li>Track responses in your quote history once submitted.</li>
        </ul>
      </PortalCard>
    </PortalShell>
  );
}
