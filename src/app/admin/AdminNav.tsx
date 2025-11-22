"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";

export default function AdminNav() {
  const pathname = usePathname();

  // Uploads lives at /admin (not /admin/uploads),
  // but this also keeps working if you ever add /admin/uploads later.
  const isUploads =
    pathname === "/admin" || pathname.startsWith("/admin/uploads");
  const isQuotes = pathname.startsWith("/admin/quotes");

  return (
    <div className="flex gap-2">
      <Link
        href="/admin"
        className={isUploads ? primaryCtaClasses : secondaryCtaClasses}
      >
        Uploads
      </Link>

      <Link
        href="/admin/quotes"
        className={isQuotes ? primaryCtaClasses : secondaryCtaClasses}
      >
        Quotes
      </Link>
    </div>
  );
}