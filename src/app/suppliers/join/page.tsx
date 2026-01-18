import type { Metadata } from "next";
import { getSearchParamValue } from "@/app/(portals)/quotes/pageUtils";
import { SupplierJoinForm } from "./SupplierJoinForm";

export const metadata: Metadata = {
  title: "Join as a supplier | Zartman",
};

type SupplierJoinPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function SupplierJoinPage({
  searchParams,
}: SupplierJoinPageProps) {
  const supplierSlug = getSearchParamValue(searchParams, "supplier");

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 py-16 sm:px-6 lg:px-8 sm:py-20">
        <section className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
              Supplier onboarding
            </p>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold text-ink sm:text-5xl heading-tight">
                Get RFQs from buyers looking to compare options
              </h1>
              <p className="text-base text-ink-muted heading-snug">
                No subscription &mdash; respond only when it fits
              </p>
            </div>
            <p className="text-sm text-ink-soft">
              Share your email and we will confirm your shop details, then send
              matching RFQs when they are a fit.
            </p>
          </div>

          <SupplierJoinForm supplierSlug={supplierSlug} />
        </section>
      </div>
    </main>
  );
}
