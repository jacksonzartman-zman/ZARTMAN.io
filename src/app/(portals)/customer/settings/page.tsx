import { requireSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";

export const dynamic = "force-dynamic";

export default async function CustomerSettingsPage() {
  const session = await requireSession({ redirectTo: "/customer" });
  const customer = await getCustomerByUserId(session.user.id);
  const email = customer?.email ?? session.user.email ?? "you@company.com";
  const companyName =
    customer?.company_name ??
    (session.user.user_metadata?.company as string | undefined) ??
    "Your company";

  const notificationPrefs = [
    {
      id: "customer-quote-status",
      label: "Quote status changes",
      description: "Alerts when RFQs move to reviewing, quoted, or approved.",
    },
    {
      id: "customer-bid",
      label: "Supplier bids",
      description: "Ping me when a supplier responds so I can review pricing.",
    },
    {
      id: "customer-messages",
      label: "Shared message threads",
      description: "Notify me when admins or suppliers add new comments.",
    },
  ];

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
        <h2 className="text-lg font-semibold text-white">Notification preferences</h2>
        <p className="mt-1 text-sm text-slate-400">
          Keep these toggled on to receive email updates while we build in-app controls.
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
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-400 focus:ring-emerald-400"
                  disabled
                />
                <span className="text-xs text-slate-500">Enabled</span>
              </label>
            </li>
          ))}
        </ul>
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
