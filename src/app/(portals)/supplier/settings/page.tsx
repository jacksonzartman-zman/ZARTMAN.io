import { requireUser } from "@/server/auth";
import {
  getSupplierApprovalStatus,
  loadSupplierProfile,
} from "@/server/suppliers";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import type { Org } from "@/types/org";
import {
  deriveOrgFromSession,
  deriveOrgSeatSummary,
} from "@/types/org";
import { SupplierNotificationSettingsForm } from "./SupplierNotificationSettingsForm";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { SupplierProfileCard } from "../components/SupplierProfileCard";

export const dynamic = "force-dynamic";

export default async function SupplierSettingsPage() {
  const user = await requireUser({ redirectTo: "/supplier" });
  const supplierEmail = normalizeEmailInput(user.email ?? null);
  const profile = supplierEmail ? await loadSupplierProfile(supplierEmail) : null;
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

  const notificationSettings = {
    notifyQuoteMessages: supplier?.notify_quote_messages ?? true,
    notifyQuoteWinner: supplier?.notify_quote_winner ?? true,
  };

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

      <SupplierProfileCard
        supplier={supplier}
        capabilities={capabilities}
        documents={documents}
        approvalsEnabled={approvalsOn}
        approvalStatus={approvalStatus}
      />

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

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Notification preferences</h2>
          <p className="mt-1 text-sm text-slate-400">
            Decide which events should hit your inbox until supplier messaging ships.
          </p>
        </div>
        {!supplier ? (
          <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-100">
            Finish onboarding so we know which supplier profile to update.
          </p>
        ) : null}
        <SupplierNotificationSettingsForm
          initialValues={notificationSettings}
          disabled={!supplier}
        />
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
