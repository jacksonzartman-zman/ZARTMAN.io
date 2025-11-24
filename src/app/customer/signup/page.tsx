import type { Metadata } from "next";
import { CustomerSignupForm } from "./CustomerSignupForm";

export const metadata: Metadata = {
  title: "Create your customer workspace | Zartman",
};

export default function CustomerSignupPage() {
  return (
    <main className="pb-16 pt-12">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 sm:px-6 lg:px-8">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">
            Customer signup
          </p>
          <h1 className="text-3xl font-semibold text-white">
            Create your customer workspace
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            We’ll use this info to spin up your Zartman workspace and email you a one-time login link.
            Use the same inbox to access your customer portal.
          </p>
        </header>

        <CustomerSignupForm />
      </div>
    </main>
  );
}
