// src/app/admin/layout.tsx
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AdminNav from "./AdminNav";
import AdminGate from "./AdminGate";
import { ADMIN_COOKIE_NAME } from "./constants";
import { requireUser } from "@/server/auth";
import { debugOnce } from "@/server/db/schemaErrors";
import { shouldLogAdminDebug } from "@/server/admin/adminDebug";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Explicit auth check (safe-deny). Admin pages are never meant for anonymous users.
  await requireUser({ redirectTo: "/login" });

  // Simple hard gate to avoid exposing service-role backed admin data to non-admins.
  const cookieStore = await cookies();
  const isUnlocked = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "1";

  if (shouldLogAdminDebug()) {
    const headerStore = await headers();
    const candidate =
      headerStore.get("next-url") ??
      headerStore.get("x-invoke-path") ??
      headerStore.get("x-nextjs-pathname") ??
      "/admin/*";

    const route =
      typeof candidate === "string" && candidate.startsWith("/admin")
        ? candidate.split("?")[0]!
        : "/admin/*";

    // Log once for seen=false and once for seen=true (per process), without leaking cookies.
    debugOnce(
      `admin_gate:cookie_seen:${isUnlocked}:${route}`,
      "[admin gate] cookie seen",
      { seen: isUnlocked, route },
    );
  }

  if (!isUnlocked) {
    const vercelEnv = process.env.VERCEL_ENV ?? "unknown";
    if (vercelEnv !== "production") {
      console.info("[admin] admin gate locked; redirecting to /admin/unlock", {
        hasAdminCookie: false,
        vercelEnv,
        redirectTarget: "/admin/unlock",
      });
      redirect("/admin/unlock");
    }
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <AdminGate />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header>
        <AdminNav />
      </header>
      {children}
    </div>
  );
}