import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthClient, getCurrentSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierByUserId } from "@/server/suppliers";
import LoginTokenBridge from "./LoginTokenBridge";

export const metadata: Metadata = {
  title: "Log in | Zartman",
};

export const dynamic = "force-dynamic";

// Behavior:
// - If not authenticated: show message linking to /supplier to request magic link
// - If authenticated and supplier profile exists: redirect("/supplier")
// - If authenticated and no supplier profile: show small "no profile found" message
// - If NEXT_PUBLIC_SHOW_LOGIN_DEBUG === "true": render extended debug panel instead of redirect

type SupabaseSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
type CustomerRecord = Awaited<ReturnType<typeof getCustomerByUserId>>;
type SupplierRecord = Awaited<ReturnType<typeof loadSupplierByUserId>>;

const SHOW_LOGIN_DEBUG = process.env.NEXT_PUBLIC_SHOW_LOGIN_DEBUG === "true";

export default async function LoginPage() {
  const cookieHeader = headers().get("cookie") ?? "";
  const cookieNames = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim().split("=")[0])
    .filter(Boolean);
  console.log("[auth] login cookies on /login:", cookieNames);

  const session = await getCurrentSession();
  const sessionSummary = {
    userId: session?.user?.id ?? null,
    email: session?.user?.email ?? null,
    isAuthenticated: Boolean(session),
  };
  console.log("[auth] session summary:", sessionSummary);

  if (!session) {
    return (
      <>
        <LoginTokenBridge />
        <NotLoggedInMessage />
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
  console.log("[auth] supplier lookup:", {
    found: roleSummary.hasSupplier,
    supplierId: supplier?.id ?? null,
  });

  if (SHOW_LOGIN_DEBUG) {
    return (
      <>
        <LoginTokenBridge />
        <LoginDebugPanel
          session={session}
          customer={customer}
          supplier={supplier}
          roleSummary={roleSummary}
        />
      </>
    );
  }

  if (roleSummary.hasSupplier) {
    redirect("/supplier");
  }

  return (
    <>
      <LoginTokenBridge />
      <MissingSupplierMessage email={session.user.email} />
    </>
  );
}

function NotLoggedInMessage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <p className="text-lg font-semibold text-white">You&apos;re not logged in.</p>
      <p className="text-sm text-slate-300">
        To request a magic link, head to the supplier portal. Use the same email you used
        during onboarding and we&apos;ll send the link right away.
      </p>
      <Link
        href="/supplier"
        className="inline-flex items-center justify-center rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-400"
      >
        Go to supplier portal
      </Link>
    </main>
  );
}

function MissingSupplierMessage({ email }: { email?: string | null }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <p className="text-lg font-semibold text-white">
        We couldn&apos;t find your supplier workspace.
      </p>
      <p className="text-sm text-slate-300">
        You&apos;re logged in as <span className="font-medium text-white">{email ?? "this account"}</span>{" "}
        but there&apos;s no supplier profile tied to it yet. Please email support so we can connect
        your account.
      </p>
      <Link
        href="mailto:support@zartman.app"
        className="inline-flex items-center justify-center rounded-full border border-slate-600 px-5 py-2 text-sm font-semibold text-slate-100 hover:border-slate-500"
      >
        Contact support
      </Link>
    </main>
  );
}

function LoginDebugPanel({
  session,
  customer,
  supplier,
  roleSummary,
}: {
  session: SupabaseSession;
  customer: CustomerRecord;
  supplier: SupplierRecord;
  roleSummary: { hasCustomer: boolean; hasSupplier: boolean };
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-page flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-slate-900 bg-slate-950/80 p-6 text-sm text-slate-200 shadow-[0_18px_40px_rgba(2,6,23,0.85)]">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Auth debug</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">
          Server sees an authenticated Supabase session
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Email: <span className="font-mono text-emerald-300">{session.user.email ?? "unknown"}</span>
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-900 bg-slate-950/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer profile</p>
            <p className="mt-2 text-sm text-slate-200">
              {roleSummary.hasCustomer
                ? `Found customer record for ${
                    (customer?.company_name ?? "").trim() || "this account"
                  }.`
                : "No customer record linked to this user yet."}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-900 bg-slate-950/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supplier profile</p>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Would redirect to</p>
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
