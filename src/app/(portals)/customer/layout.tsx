import type { ReactNode } from "react";
import PortalLayout from "../PortalLayout";

export default function CustomerPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <PortalLayout>{children}</PortalLayout>;
}
