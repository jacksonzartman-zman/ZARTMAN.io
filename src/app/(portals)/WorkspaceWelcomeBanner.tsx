import clsx from "clsx";
import type { PortalRole } from "@/types/portal";

type WorkspaceWelcomeBannerProps = {
  role: PortalRole;
  companyName: string;
};

const ROLE_ACCENTS: Record<PortalRole, string> = {
  customer: "text-emerald-300",
  supplier: "text-blue-300",
};

export function WorkspaceWelcomeBanner({
  role,
  companyName,
}: WorkspaceWelcomeBannerProps) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/70 px-6 py-5 shadow-slate-950/30">
      <p
        className={clsx(
          "text-[11px] font-semibold uppercase tracking-[0.35em]",
          ROLE_ACCENTS[role],
        )}
      >
        {role} workspace
      </p>
      <p className="mt-2 text-lg text-slate-200">
        Welcome back,{" "}
        <span className="font-semibold text-white">{companyName}</span>
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-white">
        Your {role} workspace
      </h1>
    </section>
  );
}
