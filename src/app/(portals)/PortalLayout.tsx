import type { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";
import { PortalContainer } from "./components/PortalContainer";

type PortalLayoutProps = {
  children: ReactNode;
};

export default function PortalLayout({ children }: PortalLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <AppHeader />
      <main className="py-8 sm:py-10">
        <PortalContainer>{children}</PortalContainer>
      </main>
    </div>
  );
}
