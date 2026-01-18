import Link from "next/link";
import { CUSTOMER_NOTIFICATION_OPTIONS } from "@/constants/notificationPreferences";
import { CustomerNotificationSettingsForm } from "./CustomerNotificationSettingsForm";
import { CustomerEmailRepliesDefaultsCard } from "./CustomerEmailRepliesDefaultsCard";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { loadNotificationPreferencesMap } from "@/server/notifications/preferences";
import { getCustomerEmailDefaultOptIn } from "@/server/quotes/customerEmailDefaults";
import { isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";
import type { Org } from "@/types/org";
import {
  deriveOrgFromSession,
  deriveOrgSeatSummary,
} from "@/types/org";

export const dynamic = "force-dynamic";

export default async function CustomerSettingsPage() {
  const user = await requireCustomerSessionOrRedirect("/customer/settings");
  const customer = await getCustomerByUserId(user.id);
  const email = customer?.email ?? user.email ?? "you@company.com";
  const companyName =
    customer?.company_name ??
    (user.user_metadata?.company as string | undefined) ??
    "Your company";
  const org = deriveOrgFromSession(user, companyName);
  const seatSummary = deriveOrgSeatSummary(org, user);
  const planLabel = formatPlanLabel(org.plan);

  const notificationSettings = await loadNotificationPreferencesMap({
    userId: user.id,
    role: "customer",
    eventTypes: CUSTOMER_NOTIFICATION_OPTIONS.map((option) => option.eventType),
  });

  const bridgeEnabled = isCustomerEmailBridgeEnabled();
  const emailDefaultsResult =
    customer && bridgeEnabled ? await getCustomerEmailDefaultOptIn(customer.id) : null;
  const emailDefaultsAvailability = !customer
    ? { kind: "missing_profile" as const, message: "Complete your customer profile to manage email replies." }
    : !bridgeEnabled
      ? { kind: "disabled" as const, message: "Email bridge not configured." }
      : !emailDefaultsResult
        ? { kind: "unsupported" as const, message: "Not available on this deployment." }
        : emailDefaultsResult.ok
          ? { kind: "ready" as const }
          : emailDefaultsResult.reason === "disabled"
            ? { kind: "disabled" as const, message: "Email bridge not configured." }
            : { kind: "unsupported" as const, message: "Not available on this deployment." };
  const emailDefaultsEnabled =
    emailDefaultsResult && emailDefaultsResult.ok ? emailDefaultsResult.optedIn : false;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">
          Customer workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Account settings</h1>
        <p className="mt-2 text-sm text-slate-400">
          Manage the basics for your customer portal. We’ll wire these inputs to live saves soon.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <h2 className="text-lg font-semibold text-white">Account</h2>
        <p className="mt-1 text-sm text-slate-400">
          Quick reference for your login identity. Update details on your dashboard or by contacting
          the Zartman team.
        </p>
        <dl className="mt-4 grid gap-4 text-sm text-slate-200 md:grid-cols-2">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Email
            </dt>
            <dd className="mt-1 font-mono text-slate-100">{email}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Company
            </dt>
            <dd className="mt-1 text-slate-100">{companyName}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <Link
            href="#notifications"
            className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
          >
            Manage notification settings
          </Link>
        </div>
      </section>

      <CustomerEmailRepliesDefaultsCard
        initialEnabled={emailDefaultsEnabled}
        availability={emailDefaultsAvailability}
      />

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <h2 className="text-lg font-semibold text-white">Company profile</h2>
        <p className="mt-1 text-sm text-slate-400">
          Update the contact details that appear on shared RFQs and invoices.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <SettingsField label="Company name" value={companyName} />
          <SettingsField label="Primary email" value={email} />
        </div>
        <button
          type="button"
          disabled
          className="mt-4 inline-flex cursor-not-allowed rounded-full border border-slate-800 px-4 py-1.5 text-sm font-semibold text-slate-400"
        >
          Saving soon
        </button>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <h2 className="text-lg font-semibold text-white">Organization</h2>
        <p className="mt-1 text-sm text-slate-400">
          Plan details and seat controls will live here as we roll out enterprise admin tooling.
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
          Seat management is read-only today. Ping us if you need to increase capacity ahead of time.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <h2 className="text-lg font-semibold text-white">Team</h2>
        <p className="mt-1 text-sm text-slate-400">
          Invite teammates to collaborate in your customer workspace.
        </p>
        <div className="mt-4">
          <Link
            href="/customer/settings/team"
            className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
          >
            Manage team
          </Link>
        </div>
      </section>

      <section
        id="notifications"
        className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6 space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold text-white">Notification preferences</h2>
          <p className="mt-1 text-sm text-slate-400">
            Control when we email you about quote activity while we finish the in-app inbox.
          </p>
        </div>
        {!customer ? (
          <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-100">
            Complete your customer profile to save these settings.
          </p>
        ) : null}
        <CustomerNotificationSettingsForm
          initialValues={notificationSettings}
          disabled={!customer}
        />
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <h2 className="text-lg font-semibold text-white">Integrations roadmap</h2>
        <p className="mt-1 text-sm text-slate-400">
          We’re wiring the customer portal directly into ERP and procurement tools. Flip these on
          once the connectors launch.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <IntegrationPlaceholder name="NetSuite" status="In development" />
          <IntegrationPlaceholder name="SAP" status="Scoping" />
          <IntegrationPlaceholder name="Coupa" status="Design" />
          <IntegrationPlaceholder name="email@yourdomain.com" status="Ready soon" />
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
        We’ll surface a connect button the moment this integration goes live.
      </p>
    </div>
  );
}
