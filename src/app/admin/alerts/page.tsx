import { redirect } from "next/navigation";

export default function AdminAlertsRedirectPage() {
  redirect("/admin/search-alerts");
}
