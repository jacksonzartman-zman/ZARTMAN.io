"use client";

import { usePathname } from "next/navigation";
import {
  PortalNavTabs,
  type PortalNavLink,
} from "@/app/(portals)/components/PortalNavTabs";
import { PortalContainer } from "@/app/(portals)/components/PortalContainer";

const ADMIN_NAV_LINKS: PortalNavLink[] = [
  { label: "Uploads", href: "/admin/uploads" },
  { label: "Quotes", href: "/admin/quotes" },
  { label: "Activity", href: "/admin/activity" },
  { label: "Capacity", href: "/admin/capacity" },
  { label: "Bench health", href: "/admin/suppliers/bench-health" },
  { label: "System health", href: "/admin/system-health" },
];

export default function AdminNav() {
  const pathname = usePathname() ?? "/admin/quotes";

  return (
    <div className="border-b border-slate-900 bg-slate-950/60">
      <PortalContainer className="flex items-center justify-start py-3">
        <PortalNavTabs links={ADMIN_NAV_LINKS} currentPath={pathname} />
      </PortalContainer>
    </div>
  );
}
