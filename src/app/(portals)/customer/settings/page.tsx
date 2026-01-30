import Link from "next/link";
import { CUSTOMER_NOTIFICATION_OPTIONS } from "@/constants/notificationPreferences";
import { CustomerNotificationSettingsForm } from "./CustomerNotificationSettingsForm";
import { CustomerEmailRepliesDefaultsCard } from "./CustomerEmailRepliesDefaultsCard";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
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
    <PortalShell
      workspace="customer"
      title="Settings"
      subtitle="Manage workspace basics, team access, and notification preferences."
      actions={
        <Link
          href="/customer"
          className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
        >
          Back to dashboard
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <PortalCard
          title="Workspace"
          description="Basics about your account, company profile, and team access."
          className="lg:col-span-2"
          action={
            <Link
              href="#notifications"
              className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
            >
              Notification preferences
            </Link>
          }
        >
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Account
              </p>
              <dl className="grid gap-3 text-sm text-slate-200">
                <div className="rounded-xl bg-slate-950/20 px-4 py-3 ring-1 ring-slate-800/50">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Email
                  </dt>
                  <dd className="mt-1 font-mono text-slate-100">{email}</dd>
                </div>
                <div className="rounded-xl bg-slate-950/20 px-4 py-3 ring-1 ring-slate-800/50">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Company
                  </dt>
                  <dd className="mt-1 text-slate-100">{companyName}</dd>
                </div>
              </dl>
            </div>

            <div className="space-y-3 lg:col-span-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Company profile
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    These details appear on shared search requests and invoices.
                  </p>
                </div>
                <Link
                  href="/customer/settings/team"
                  className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
                >
                  Manage team
                </Link>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <SettingsField label="Company name" value={companyName} />
                <SettingsField label="Primary email" value={email} />
              </div>
              <p className="text-xs text-slate-500">
                Company profile editing is not available yet.
              </p>
            </div>
          </div>
        </PortalCard>

        <CustomerEmailRepliesDefaultsCard
          initialEnabled={emailDefaultsEnabled}
          availability={emailDefaultsAvailability}
          className="lg:col-span-2"
        />

        <PortalCard
          title="Organization"
          description="Plan and seat summary (read-only for now)."
          className="lg:col-span-2"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <SettingsField label="Org name" value={org.name} />
            <SettingsField label="Plan" value={planLabel} />
            <SettingsField label="Seats in use" value={`${seatSummary.used} / ${seatSummary.total}`} />
            <SettingsField label="Seats available" value={`${seatSummary.available}`} />
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Seat management is read-only today. Ping us if you need to increase capacity ahead of time.
          </p>
        </PortalCard>

        <PortalCard
          id="notifications"
          title="Notification preferences"
          description="Control when we email you about quote activity."
          className="lg:col-span-2"
        >
          <div className="space-y-5">
            {!customer ? (
              <p className="rounded-xl bg-yellow-500/5 px-4 py-3 text-xs text-yellow-100 ring-1 ring-yellow-500/30">
                Complete your customer profile to save these settings.
              </p>
            ) : null}
            <CustomerNotificationSettingsForm initialValues={notificationSettings} disabled={!customer} />
          </div>
        </PortalCard>

        <PortalCard
          title="Integrations"
          description="Connectors and exports (not yet available)."
          className="lg:col-span-2"
        >
          <details className="group rounded-xl bg-slate-950/15 px-4 py-3 ring-1 ring-slate-800/40">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-200">
              <span>Show planned integrations</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 transition group-open:text-slate-300">
                Coming soon
              </span>
            </summary>
            <div className="mt-4 overflow-hidden rounded-xl bg-slate-950/10 ring-1 ring-slate-800/40">
              <div className="divide-y divide-slate-800/30">
                <IntegrationPlaceholder name="NetSuite" status="In development" />
                <IntegrationPlaceholder name="SAP" status="Scoping" />
                <IntegrationPlaceholder name="Coupa" status="Design" />
              </div>
            </div>
          </details>
        </PortalCard>
      </div>
    </PortalShell>
  );
}

function SettingsField({ label, value }: { label: string; value: string }) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </span>
      <input
        type="text"
        readOnly
        value={value}
        className="w-full rounded-xl bg-slate-950/35 px-3 py-2.5 text-sm text-slate-100 ring-1 ring-slate-800/50"
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
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <p className="truncate text-sm font-semibold text-slate-200">{name}</p>
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {status}
      </p>
    </div>
  );
}
