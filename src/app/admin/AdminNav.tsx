"use client";

import { usePathname } from "next/navigation";
import { PortalNavTabs } from "@/app/(portals)/components/PortalNavTabs";

const ADMIN_NAV_LINKS = [
  { label: "Uploads", href: "/admin" },
  { label: "Quotes", href: "/admin/quotes" },
];

export default function AdminNav() {
  const pathname = usePathname() ?? "/";

  return <PortalNavTabs links={ADMIN_NAV_LINKS} currentPath={pathname} />;
}