// src/app/admin/page.tsx

import { redirect } from "next/navigation";
import { requireAdminUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminEntryPage() {
  await requireAdminUser({ redirectTo: "/login" });
  redirect("/admin/overview");
}
