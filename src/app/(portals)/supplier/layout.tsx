import type { ReactNode } from "react";
import { getServerAuthUser } from "@/server/auth";
import PortalLayout from "../PortalLayout";

export default async function SupplierPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await getServerAuthUser();

  return <PortalLayout>{children}</PortalLayout>;
}
