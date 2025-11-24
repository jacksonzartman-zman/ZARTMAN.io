import type { ReactNode } from "react";
import PortalLayout from "../PortalLayout";
import { PortalLoginPanel } from "../PortalLoginPanel";
import { getCurrentSession } from "@/server/auth";

export default async function CustomerPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentSession();

  if (!session) {
    return (
      <PortalLayout>
        <PortalLoginPanel role="customer" fallbackRedirect="/customer" />
      </PortalLayout>
    );
  }

  return <PortalLayout>{children}</PortalLayout>;
}
