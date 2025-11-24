import type { ReactNode } from "react";
import PortalLayout from "../PortalLayout";

export default function SupplierPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <PortalLayout>{children}</PortalLayout>;
}
