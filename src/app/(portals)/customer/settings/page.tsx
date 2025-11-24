import { requireSession } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function CustomerSettingsPage() {
  await requireSession({ redirectTo: "/customer" });

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
      <h1 className="text-2xl font-semibold text-white">Account settings</h1>
      <p className="mt-2 text-sm text-slate-400">
        This section will allow you to manage your profile, team, and notifications.
      </p>
      <div className="mt-4 rounded-xl border border-dashed border-slate-800/80 bg-slate-950/40 px-4 py-6 text-sm text-slate-400">
        This section is coming soon.
      </div>
    </section>
  );
}
