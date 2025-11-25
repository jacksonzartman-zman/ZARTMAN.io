import type { ReactNode } from "react";
import { getCurrentSession } from "@/server/auth";
import PortalLayout from "../PortalLayout";

export default async function SupplierPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { session } = await getCurrentSession();
  console.log("[supplier layout] server session email:", session?.user?.email ?? null);

  return <PortalLayout>{children}</PortalLayout>;
}
