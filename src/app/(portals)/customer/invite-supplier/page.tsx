import Link from "next/link";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { inviteSupplierAction } from "./actions";

export const dynamic = "force-dynamic";

type CustomerInviteSupplierPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerInviteSupplierPage({
  searchParams,
}: CustomerInviteSupplierPageProps) {
  const user = await requireCustomerSessionOrRedirect("/customer/invite-supplier");
  const customer = await getCustomerByUserId(user.id);
  const resolvedParams = searchParams ? await searchParams : undefined;
  const submitted = firstString(resolvedParams?.submitted);
  const error = firstString(resolvedParams?.error);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Invite a supplier"
        subtitle="Introduce suppliers you want to work with."
      >
        <section className="rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
          <p className="text-sm text-slate-300">
            We couldn&apos;t find a customer workspace linked to {user.email}. Complete your profile
            to invite suppliers.
          </p>
          <Link
            href="/customer"
            className="mt-4 inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Back to dashboard
          </Link>
        </section>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      workspace="customer"
      title="Invite a supplier"
      subtitle="Share a supplier contact and we’ll follow up after verification."
    >
      {submitted ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          We&apos;ll reach out and add them once verified.
        </p>
      ) : null}

      {error ? (
        <p
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <PortalCard
        title="Supplier details"
        description="Send us their name and email. We’ll handle the rest."
      >
        <form action={inviteSupplierAction} className="space-y-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Supplier name
            </span>
            <input
              name="supplierName"
              type="text"
              required
              placeholder="Precision Parts Co."
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Supplier email
            </span>
            <input
              name="email"
              type="email"
              required
              placeholder="sales@supplier.com"
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Note (optional)
            </span>
            <textarea
              name="note"
              rows={4}
              placeholder="Share any helpful context for our outreach."
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
          </label>

          <button
            type="submit"
            className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
          >
            Submit invite
          </button>
        </form>
      </PortalCard>
    </PortalShell>
  );
}

function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" ? value : null;
}
