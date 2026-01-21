import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminAlertsRedirectPage() {
  redirect("/admin/search-alerts");
}
