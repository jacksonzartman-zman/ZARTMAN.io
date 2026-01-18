import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { requireAdminUser } from "@/server/auth";
import ProviderImportForm from "./ProviderImportForm";

export const dynamic = "force-dynamic";

export default async function AdminProviderImportPage() {
  await requireAdminUser({ redirectTo: "/login" });

  return (
    <AdminDashboardShell
      title="Provider import"
      description="Bulk create providers for RFQ routing and onboarding."
    >
      <ProviderImportForm />
    </AdminDashboardShell>
  );
}
