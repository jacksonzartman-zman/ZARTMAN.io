import type { Metadata } from "next";
import { SupplierSignupForm } from "./SupplierSignupForm";

export const metadata: Metadata = {
  title: "Become a Zartman supplier | Zartman",
};

export default function SupplierSignupPage() {
  return (
    <main className="pb-16 pt-12">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 sm:px-6 lg:px-8">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
            Supplier signup
          </p>
          <h1 className="text-3xl font-semibold text-white">
            Become a Zartman supplier
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Tell us a bit about your shop. We’ll email a one-time magic link so you can finish onboarding
            and start seeing RFQs.
          </p>
        </header>

        <SupplierSignupForm />
      </div>
    </main>
  );
}
