import Link from "next/link";
import { getSearchParamValue, normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import PortalCard from "../../PortalCard";
import { SupplierOnboardingForm } from "./SupplierOnboardingForm";

type NextAppPage<P = any> = (
  props: Omit<P, "params" | "searchParams"> & {
    params?: Promise<Record<string, unknown>>;
    searchParams?: Promise<any>;
  },
) => JSX.Element | Promise<JSX.Element>;

export const dynamic = "force-dynamic";

type SupplierOnboardingPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function SupplierOnboardingPage({
  searchParams,
}: SupplierOnboardingPageProps) {
  const emailParam = getSearchParamValue(searchParams, "email");
  const normalizedEmail = normalizeEmailInput(emailParam);

  return (
    <div className="space-y-6">
      <PortalCard
        title="Supplier onboarding"
        description="Share your capabilities so we can match RFQs, bids, and compliance docs to your workspace."
        action={
          <Link
            href="/supplier"
            className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-blue-300 transition hover:border-blue-400 hover:text-blue-200"
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

      <SupplierOnboardingForm defaultEmail={normalizedEmail ?? undefined} />
    </div>
  );
}

export default SupplierOnboardingPage as unknown as NextAppPage<SupplierOnboardingPageProps>;
