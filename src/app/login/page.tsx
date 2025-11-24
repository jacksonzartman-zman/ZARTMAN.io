import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { primaryCtaClasses } from "@/lib/ctas";

export const metadata: Metadata = {
  title: "Log in | Zartman",
};

const CARD_COPY = [
  {
    role: "Customers",
    title: "Customer login",
    description: "Sign in to track RFQs, quotes, and orders.",
    href: "/customer",
    accent: "from-emerald-400/20 via-emerald-500/10 to-transparent",
    button: "Go to customer portal",
  },
  {
    role: "Suppliers",
    title: "Supplier login",
    description: "Sign in to see matched RFQs and manage bids.",
    href: "/supplier",
    accent: "from-blue-400/20 via-blue-500/10 to-transparent",
    button: "Go to supplier portal",
  },
];

export default function LoginHubPage() {
  return (
    <main className="pb-16 pt-12">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">
            Auth
          </p>
          <h1 className="text-3xl font-semibold text-white">Choose how you work with Zartman</h1>
          <p className="text-sm text-slate-400">
            Pick the workspace that matches your role — each portal will email you a one-time magic link.
          </p>
        </div>

        <section className="grid gap-6 lg:grid-cols-2">
          {CARD_COPY.map((card) => (
            <article
              key={card.title}
              className="rounded-3xl border border-slate-900 bg-slate-950/60 p-6 shadow-lift-sm"
            >
              <div className={clsx("h-1.5 w-16 rounded-full bg-gradient-to-r", card.accent)} />
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                {card.role}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{card.description}</p>
              <Link
                href={card.href}
                className={clsx(primaryCtaClasses, "mt-6 inline-flex w-full justify-center")}
              >
                {card.button}
              </Link>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
