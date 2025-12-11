// src/app/admin/layout.tsx
import type { ReactNode } from "react";
import AdminNav from "./AdminNav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      {/* Admin nav */}
      <header>
        <AdminNav />
      </header>

      {/* Page content */}
      {children}
    </div>
  );
}