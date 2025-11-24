import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import clsx from "clsx";
import { primaryCtaClasses } from "@/lib/ctas";
import { createAuthClient, getCurrentSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierByUserId } from "@/server/suppliers";
import LoginTokenBridge from "./LoginTokenBridge";

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

export default async function LoginPage() {
  const session = await getCurrentSession();

  if (!session) {
    return (
      <>
        <LoginTokenBridge />
        <LoginHubView
          cards={DEFAULT_CARDS}
          eyebrow="Debug"
          title="Log in to Zartman"
          description="No Supabase session detected on the server. Use a magic link to sign in."
        />
      </>
    );
  }

  const [customer, supplier] = await Promise.all([
    getCustomerByUserId(session.user.id),
    loadSupplierByUserId(session.user.id),
  ]);

  const roleSummary = {
    hasCustomer: Boolean(customer),
    hasSupplier: Boolean(supplier),
  };

  return (
    <>
      <LoginTokenBridge />
      <main className="mx-auto flex min-h-[60vh] max-w-page flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-slate-900 bg-slate-950/80 p-6 text-sm text-slate-200 shadow-[0_18px_40px_rgba(2,6,23,0.85)]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Auth debug
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">
            Server sees an authenticated Supabase session
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Email:{" "}
            <span className="font-mono text-emerald-300">
              {session.user.email ?? "unknown"}
            </span>
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-900 bg-slate-950/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Customer profile
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {roleSummary.hasCustomer
                  ? `Found customer record for ${
                      (customer?.company_name ?? "").trim() || "this account"
                    }.`
                  : "No customer record linked to this user yet."}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-900 bg-slate-950/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Supplier profile
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {roleSummary.hasSupplier
                  ? `Found supplier profile for ${
                      (
                        supplier?.company_name ??
                        supplier?.primary_email ??
                        ""
                      ).trim() || "this account"
                    }.`
                  : "No supplier profile linked to this user yet."}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-900 bg-slate-950/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Would redirect to
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {roleSummary.hasCustomer && !roleSummary.hasSupplier
                  ? "/customer"
                  : !roleSummary.hasCustomer && roleSummary.hasSupplier
                  ? "/supplier"
                  : roleSummary.hasCustomer && roleSummary.hasSupplier
                  ? "Dual-role: login hub asking you to pick a workspace"
                  : "Login hub (no roles yet)"}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/customer"
              className="inline-flex items-center justify-center rounded-full border border-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-700 hover:text-white"
            >
              Go to customer portal
            </Link>
            <Link
              href="/supplier"
              className="inline-flex items-center justify-center rounded-full border border-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-700 hover:text-white"
            >
              Go to supplier portal
            </Link>
            <form action={signOutAction} className="inline-flex">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-full bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/20"
              >
                Log out
              </button>
            </form>
          </div>
        </section>
      </main>
    </>
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

async function signOutAction() {
  "use server";

  const supabase = createAuthClient();
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error("[login page] sign out failed", error);
  }
  redirect("/");
}
