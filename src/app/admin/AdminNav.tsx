// src/app/admin/AdminNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Uploads" },
  { href: "/admin/quotes", label: "Quotes" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-3 text-xs sm:text-sm">
      {links.map((link) => {
        const isActive =
          pathname === link.href || pathname.startsWith(link.href + "/");

        return (
          <Link
            key={link.href}
            href={link.href}
            className={[
              "rounded-full px-3 py-1 transition",
              isActive
                ? "bg-emerald-500 text-slate-950 font-medium"
                : "text-slate-300 hover:bg-slate-800 hover:text-slate-50",
            ].join(" ")}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}