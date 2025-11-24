import Link from "next/link";
import { requireSession } from "@/server/auth";
import { loadSupplierProfile } from "@/server/suppliers";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import type { Org } from "@/types/org";
import {
  deriveOrgFromSession,
  deriveOrgSeatSummary,
} from "@/types/org";

export const dynamic = "force-dynamic";

export default async function SupplierSettingsPage() {
  const session = await requireSession({ redirectTo: "/supplier" });
  const supplierEmail = normalizeEmailInput(session.user.email ?? null);
  const profile = supplierEmail ? await loadSupplierProfile(supplierEmail) : null;
  const supplier = profile?.supplier ?? null;
  const hasProfile = Boolean(supplier);
  const companyName =
    supplier?.company_name ??
    (session.user.user_metadata?.company as string | undefined) ??
    "Your shop";
  const primaryEmail = supplier?.primary_email ?? supplierEmail ?? "shop@example.com";
  const phone = supplier?.phone ?? "Not provided";
  const website = supplier?.website ?? "Not provided";
  const country = supplier?.country ?? "Not provided";
  const org = deriveOrgFromSession(session, companyName);
  const seatSummary = deriveOrgSeatSummary(org, session);
  const planLabel = formatPlanLabel(org.plan);

  const notificationPrefs = [
    {
      id: "supplier-rfq-matches",
      label: "New RFQ matches",
      description: "Email me when a fresh RFQ lands in my workspace.",
    },
    {
      id: "supplier-bid-status",
      label: "Bid decisions",
      description: "Alerts when a customer accepts, declines, or requests updates.",
    },
    {
      id: "supplier-chat",
      label: "Shared chat unlocks",
      description: "Get notified when messaging opens up for a quote.",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
          Supplier workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Account settings</h1>
        <p className="mt-2 text-sm text-slate-400">
          Confirm the details we show buyers when routing RFQs to your team.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Shop profile</h2>
            <p className="mt-1 text-sm text-slate-400">
              This mirrors what you filled out during onboarding. Refresh it to keep matches accurate.
            </p>
          </div>
          <Link
            href="/supplier/onboarding"
            className="rounded-full border border-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-100 transition hover:border-slate-700"
          >
            {hasProfile ? "Update profile" : "Finish onboarding"}
          </Link>
        </div>
        {hasProfile ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <SettingsField label="Company name" value={companyName} />
            <SettingsField label="Primary email" value={primaryEmail} />
            <SettingsField label="Phone" value={phone} />
            <SettingsField label="Website" value={website} />
            <SettingsField label="Country" value={country} />
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-blue-500/30 bg-blue-500/5 px-3 py-3 text-sm text-blue-100">
            Complete onboarding to publish verified company info and unlock instant RFQ routing.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <h2 className="text-lg font-semibold text-white">Organization</h2>
        <p className="mt-1 text-sm text-slate-400">
          Track which plan you&apos;re on and how many teammates can join the supplier portal.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <SettingsField label="Org name" value={org.name} />
          <SettingsField label="Plan" value={planLabel} />
          <SettingsField
            label="Seats in use"
            value={`${seatSummary.used} / ${seatSummary.total}`}
          />
          <SettingsField
            label="Seats available"
            value={`${seatSummary.available}`}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Seat management is read-only today. We&apos;ll unlock invites and removals soon.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <h2 className="text-lg font-semibold text-white">Notification preferences</h2>
        <p className="mt-1 text-sm text-slate-400">
          We’re still sending these via email only. Toggles stay on until the inbox is live.
        </p>
        <ul className="mt-4 space-y-3">
          {notificationPrefs.map((pref) => (
            <li
              key={pref.id}
              className="flex flex-col gap-2 rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-white">{pref.label}</p>
                <p className="text-xs text-slate-400">{pref.description}</p>
              </div>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-400 focus:ring-blue-400"
                  disabled
                />
                <span className="text-xs text-slate-500">Enabled</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <h2 className="text-lg font-semibold text-white">Future integrations</h2>
        <p className="mt-1 text-sm text-slate-400">
          Connect your shop management tools as soon as these adapters roll out.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <IntegrationPlaceholder name="ProShop ERP" status="In development" />
          <IntegrationPlaceholder name="JobBOSS" status="Scoping" />
          <IntegrationPlaceholder name="CSV export" status="Ready soon" />
          <IntegrationPlaceholder name="Custom webhook" status="Design" />
        </div>
      </section>
    </div>
  );
}

function SettingsField({ label, value }: { label: string; value: string }) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        type="text"
        readOnly
        value={value}
        className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function formatPlanLabel(plan: Org["plan"]): string {
  switch (plan) {
    case "enterprise":
      return "Enterprise";
    case "pro":
      return "Pro";
    default:
      return "Basic";
  }
}

function IntegrationPlaceholder({
  name,
  status,
}: {
  name: string;
  status: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-800/70 bg-slate-950/40 p-4">
      <p className="text-sm font-semibold text-white">{name}</p>
      <p className="text-xs text-slate-500">{status}</p>
      <p className="mt-2 text-xs text-slate-500">
        We’ll ping your inbox when this connector is enabled.
      </p>
    </div>
  );
}
