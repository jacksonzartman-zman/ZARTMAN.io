import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { requireAdminUser } from "@/server/auth";
import { getOpsSlaSettings } from "@/server/ops/settings";
import { OpsSlaSettingsForm } from "./OpsSlaSettingsForm";

export const dynamic = "force-dynamic";

export default async function AdminOpsSettingsPage() {
  await requireAdminUser({ redirectTo: "/login" });
  const settings = await getOpsSlaSettings();

  return (
    <AdminDashboardShell
      title="Ops SLA settings"
      description="Tune thresholds for dispatch follow-ups in the ops inbox."
    >
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/40 p-6">
        <OpsSlaSettingsForm
          initialConfig={settings.config}
          messageReplyMaxHours={settings.messageReplyMaxHours}
          updatedAt={settings.updatedAt}
          usingFallback={settings.usingFallback}
          messageReplyUsingFallback={settings.messageReplyUsingFallback}
        />
      </section>
    </AdminDashboardShell>
  );
}
