// src/app/c/admin/page.tsx

import { redirect } from "next/navigation";
import { requireAdminUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminAliasEntryPage() {
  await requireAdminUser({ redirectTo: "/login" });
  redirect("/admin/quotes");
}
