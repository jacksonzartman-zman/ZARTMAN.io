import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import clsx from "clsx";
import { primaryCtaClasses } from "@/lib/ctas";
import { getCurrentSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierByUserId } from "@/server/suppliers";

export const metadata: Metadata = {
  title: "Log in | Zartman",
};

export const dynamic = "force-dynamic";

type LoginCard = {
  role: string;
  title: string;
  description: string;
  href: string;
  accent: string;
  button: string;
};

const DEFAULT_CARDS: LoginCard[] = [
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

const WORKSPACE_CARDS: LoginCard[] = [
  {
    role: "Customer access",
    title: "Customer workspace",
    description: "Open the customer dashboard with RFQs, quotes, and order tracking.",
    href: "/customer",
    accent: "from-emerald-400/20 via-emerald-500/10 to-transparent",
    button: "Enter customer workspace",
  },
  {
    role: "Supplier access",
    title: "Supplier workspace",
    description: "Jump into supplier tools to review matches and manage bids.",
    href: "/supplier",
    accent: "from-blue-400/20 via-blue-500/10 to-transparent",
    button: "Enter supplier workspace",
  },
];

export default async function LoginHubPage() {
  const session = await getCurrentSession();

  if (!session) {
    return <LoginHubView cards={DEFAULT_CARDS} />;
  }

  const [customer, supplier] = await Promise.all([
    getCustomerByUserId(session.user.id),
    loadSupplierByUserId(session.user.id),
  ]);

  if (customer && !supplier) {
    redirect("/customer");
  }

  if (supplier && !customer) {
    redirect("/supplier");
  }

  if (!customer && !supplier) {
    return <LoginHubView cards={DEFAULT_CARDS} />;
  }

  return (
    <LoginHubView
      cards={WORKSPACE_CARDS}
      eyebrow="Multi-role"
      title="Choose your workspace"
      description="You have access to both portals — pick where you’d like to go."
    />
  );
}

type LoginHubViewProps = {
  cards: LoginCard[];
  eyebrow?: string;
  title?: string;
  description?: string;
};

function LoginHubView({
  cards,
  eyebrow = "Auth",
  title = "Choose how you work with Zartman",
  description = "Pick the workspace that matches your role — each portal will email you a one-time magic link.",
}: LoginHubViewProps) {
  return (
    <main className="pb-16 pt-12">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">
            {eyebrow}
          </p>
          <h1 className="text-3xl font-semibold text-white">{title}</h1>
          <p className="text-sm text-slate-400">{description}</p>
        </div>

        <section className="grid gap-6 lg:grid-cols-2">
          {cards.map((card) => (
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
