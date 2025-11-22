"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ctaSizeClasses,
  primaryCtaClasses,
  secondaryCtaClasses,
} from "@/lib/ctas";

export default function AdminNav() {
  const pathname = usePathname();

  // Uploads lives at /admin (not /admin/uploads),
  // but this also keeps working if you ever add /admin/uploads later.
  const isUploads =
    pathname === "/admin" || pathname.startsWith("/admin/uploads");
  const isQuotes = pathname.startsWith("/admin/quotes");

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/admin"
        className={clsx(
          isUploads ? primaryCtaClasses : secondaryCtaClasses,
          ctaSizeClasses.sm,
          "whitespace-nowrap",
        )}
      >
        Uploads
      </Link>

      <Link
        href="/admin/quotes"
        className={clsx(
          isQuotes ? primaryCtaClasses : secondaryCtaClasses,
          ctaSizeClasses.sm,
          "whitespace-nowrap",
        )}
      >
        Quotes
      </Link>
    </div>
  );
}