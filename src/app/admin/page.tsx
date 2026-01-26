// src/app/admin/page.tsx

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME } from "./constants";
import { requireUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminEntryPage() {
  const vercelEnv = process.env.VERCEL_ENV ?? "unknown";
  const user = await requireUser({ redirectTo: "/login?next=/admin/quotes" });
  const cookieStore = await cookies();
  const hasAdminCookie = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "1";

  const redirectTarget = hasAdminCookie ? "/admin/quotes" : "/admin/unlock";
  console.info("[admin] /admin entry decision", {
    userId: user.id,
    hasAdminCookie,
    vercelEnv,
    redirectTarget,
  });

  redirect(redirectTarget);
}
