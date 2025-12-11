"use client";

import { usePathname } from "next/navigation";
import {
  PortalNavTabs,
  type PortalNavLink,
} from "@/app/(portals)/components/PortalNavTabs";

const ADMIN_NAV_LINKS: PortalNavLink[] = [
  { label: "Uploads", href: "/admin" },
  { label: "Quotes", href: "/admin/quotes" },
];

export default function AdminNav() {
  const pathname = usePathname() ?? "/admin";

  return (
    <div className="border-b border-slate-900 bg-slate-950/60">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-start px-6 py-3">
        <PortalNavTabs links={ADMIN_NAV_LINKS} currentPath={pathname} />
      </div>
    </div>
  );
}