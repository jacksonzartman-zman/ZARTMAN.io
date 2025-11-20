"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminNav() {
  const pathname = usePathname();

  // Uploads lives at /admin (not /admin/uploads),
  // but this also keeps working if you ever add /admin/uploads later.
  const isUploads =
    pathname === "/admin" || pathname.startsWith("/admin/uploads");
  const isQuotes = pathname.startsWith("/admin/quotes");

  const base =
    "px-4 py-2 rounded-full text-sm font-medium transition";
  const active =
    "bg-emerald-500 text-slate-900";
  const inactive =
    "text-emerald-400 border border-emerald-600 hover:bg-emerald-900";

  return (
    <div className="flex gap-2">
      <Link
        href="/admin"
        className={`${base} ${isUploads ? active : inactive}`}
      >
        Uploads
      </Link>

      <Link
        href="/admin/quotes"
        className={`${base} ${isQuotes ? active : inactive}`}
      >
        Quotes
      </Link>
    </div>
  );
}