import Link from "next/link";
import { SUPPLIER_NOTIFICATION_OPTIONS } from "@/constants/notificationPreferences";
import { SupplierNotificationSettingsForm } from "./SupplierNotificationSettingsForm";
import { requireUser } from "@/server/auth";
import { loadNotificationPreferencesMap } from "@/server/notifications/preferences";
import {
  getSupplierApprovalStatus,
  loadSupplierProfileByUserId,
} from "@/server/suppliers";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { SupplierProfileCard } from "../components/SupplierProfileCard";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import type { Org } from "@/types/org";
import {
  deriveOrgFromSession,
  deriveOrgSeatSummary,
} from "@/types/org";

export const dynamic = "force-dynamic";

export default async function SupplierSettingsPage() {
  const user = await requireUser({ redirectTo: "/supplier" });
  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;
  const capabilities = profile?.capabilities ?? [];
  const documents = profile?.documents ?? [];
  const approvalsOn = approvalsEnabled();
  const supplierStatus = supplier?.status ?? "pending";
  const approvalStatus =
    profile?.approvalStatus ??
    getSupplierApprovalStatus({ status: supplierStatus });
  const companyName =
    supplier?.company_name ??
    (user.user_metadata?.company as string | undefined) ??
    "Your shop";
  const org = deriveOrgFromSession(user, companyName);
  const seatSummary = deriveOrgSeatSummary(org, user);
  const planLabel = formatPlanLabel(org.plan);

  const notificationSettings = await loadNotificationPreferencesMap({
    userId: user.id,
    role: "supplier",
    eventTypes: SUPPLIER_NOTIFICATION_OPTIONS.map((option) => option.eventType),
  });

  return (
    <PortalShell
      workspace="supplier"
      title="Settings"
      subtitle="Manage profile, team access, capacity signals, and notification preferences."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="#notifications"
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            Notification preferences
          </Link>
          <Link
            href="/supplier"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
          >
            Back to dashboard
          </Link>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <SupplierProfileCard
            supplier={supplier}
            capabilities={capabilities}
            documents={documents}
            approvalsEnabled={approvalsOn}
            approvalStatus={approvalStatus}
          />
        </div>

        <PortalCard
          title="Workspace"
          description="Quick links and read-only plan details."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Quick links
              </p>
              <div className="space-y-2">
                <SettingsLink
                  href="/supplier/settings/team"
                  title="Team"
                  description="Invite teammates and manage access."
                />
                <SettingsLink
                  href="/supplier/settings/capacity"
                  title="Capacity"
                  description="Share weekly capacity snapshots."
                />
                <SettingsLink
                  href="/supplier/settings/processes"
                  title="Processes"
                  description="Keep supported processes up to date."
                />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Organization
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
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
              <p className="text-xs text-slate-500">
                Team management lives in{" "}
                <Link
                  href="/supplier/settings/team"
                  className="font-semibold text-blue-200 underline-offset-4 hover:underline"
                >
                  Team settings
                </Link>
                .
              </p>
            </div>
          </div>
        </PortalCard>

        <PortalCard
          id="notifications"
          title="Notification preferences"
          description="Decide which events should hit your inbox."
          className="lg:col-span-2"
        >
          <div className="space-y-5">
            {!supplier ? (
              <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-100">
                Finish onboarding so we know which supplier profile to update.
              </p>
            ) : null}
            <SupplierNotificationSettingsForm
              initialValues={notificationSettings}
              disabled={!supplier}
            />
          </div>
        </PortalCard>

        <PortalCard
          title="Integrations"
          description="Connect your shop tools as adapters roll out."
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
                <IntegrationPlaceholderRow name="ProShop ERP" status="In development" />
                <IntegrationPlaceholderRow name="JobBOSS" status="Scoping" />
                <IntegrationPlaceholderRow name="CSV export" status="Design" />
                <IntegrationPlaceholderRow name="Custom webhook" status="Design" />
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

function SettingsLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start justify-between gap-4 rounded-xl bg-slate-950/20 px-4 py-3 ring-1 ring-slate-800/50 transition hover:bg-slate-950/30"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-xs text-slate-400">{description}</p>
      </div>
      <span className="mt-0.5 shrink-0 text-slate-500 transition group-hover:text-slate-300">
        →
      </span>
    </Link>
  );
}

function IntegrationPlaceholderRow({
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
