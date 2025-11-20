// src/app/admin/layout.tsx
import type { ReactNode } from "react";
import AdminNav from "./AdminNav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      {/* Top bar + nav */}
      <header className="border-b border-slate-800">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div className="text-sm font-semibold tracking-tight">
            zartman.io <span className="text-slate-400">admin</span>
          </div>
          <AdminNav />
        </div>
      </header>

      {/* Page content */}
      {children}
    </div>
  );
}