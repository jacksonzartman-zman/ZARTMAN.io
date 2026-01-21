// src/app/admin/layout.tsx
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import AdminNav from "./AdminNav";
import AdminGate from "./AdminGate";
import { ADMIN_COOKIE_NAME } from "./constants";
import { requireUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Explicit auth check (safe-deny). Admin pages are never meant for anonymous users.
  await requireUser({ redirectTo: "/login" });

  // Simple hard gate to avoid exposing service-role backed admin data to non-admins.
  const cookieStore = await cookies();
  const isUnlocked = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "1";

  if (!isUnlocked) {
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