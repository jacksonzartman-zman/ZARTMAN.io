import type React from "react";
import Link from "next/link";
import { getCurrentSession } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import PortalCard from "../../PortalCard";
import { SupplierOnboardingForm } from "./SupplierOnboardingForm";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";

type NextAppPage<P = any> = (
  props: Omit<P, "params" | "searchParams"> & {
    params?: Promise<Record<string, unknown>>;
    searchParams?: Promise<any>;
  },
) => React.ReactElement | Promise<React.ReactElement>;

export const dynamic = "force-dynamic";

type SupplierOnboardingPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

async function SupplierOnboardingPage({
  searchParams,
}: SupplierOnboardingPageProps) {
  const session = await getCurrentSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <PortalCard
          title="Sign in to finish onboarding"
          description="We sent you a one-time magic link the last time you accessed the supplier portal."
          action={
            <Link href="/supplier" className={primaryCtaClasses}>
              Back to supplier portal
            </Link>
          }
        >
          <p className="text-sm text-slate-300">
            Open the portal again to request another email-only magic link. From there, the onboarding
            form will reopen automatically.
          </p>
        </PortalCard>
      </div>
    );
  }
  const profile = await loadSupplierProfileByUserId(session.user.id);
  const supplier = profile?.supplier ?? null;

  return (
    <div className="space-y-6">
      <PortalCard
        title="Supplier onboarding"
        description="Share your capabilities so we can match RFQs, bids, and compliance docs to your workspace."
        action={
          <Link
            href="/supplier"
            className={secondaryCtaClasses}
          >
            Back to supplier portal
          </Link>
        }
      >
        <p className="text-sm text-slate-300">
          Complete this profile once. We’ll route RFQs to your inbox automatically whenever
          there’s a process and certification match.
        </p>
      </PortalCard>

        <SupplierOnboardingForm
          defaultEmail={supplier?.primary_email ?? session.user.email ?? undefined}
          defaultCompany={supplier?.company_name ?? undefined}
          defaultPhone={supplier?.phone ?? undefined}
          defaultWebsite={supplier?.website ?? undefined}
          defaultCountry={supplier?.country ?? undefined}
          supplierId={supplier?.id}
        />
    </div>
  );
}

export default SupplierOnboardingPage as unknown as NextAppPage<SupplierOnboardingPageProps>;
