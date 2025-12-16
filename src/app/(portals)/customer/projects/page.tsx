import clsx from "clsx";
import Link from "next/link";

import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { formatDateTime } from "@/lib/formatDate";
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { getCustomerAwardedQuotesForProjects } from "@/server/customer/projects";

export const dynamic = "force-dynamic";

function formatAwardedDate(value: string | null): string {
  if (!value) return "—";
  return formatDateTime(value) ?? "—";
}

function formatKickoffStatus(summary: {
  totalTasks: number;
  completedTasks: number;
  isComplete: boolean;
}): { label: string; detail: string; tone: string } {
  const total = Math.max(0, Math.floor(summary.totalTasks ?? 0));
  const completed = Math.max(0, Math.floor(summary.completedTasks ?? 0));
  const isComplete = Boolean(summary.isComplete);
  const label = isComplete ? "Complete" : "In progress";
  const detail = total > 0 ? `${completed} / ${total}` : "—";
  const tone = isComplete ? "text-emerald-300" : "text-blue-200";
  return { label, detail, tone };
}

export default async function CustomerProjectsPage() {
  const user = await requireUser({ redirectTo: "/customer/projects" });
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Projects"
        subtitle="Awarded jobs in progress and history."
      >
        <section className="space-y-3 rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
          <p className="text-sm text-slate-300">
            We couldn&apos;t find a customer workspace linked to {user.email}. Go back to your dashboard
            and complete your profile to start tracking projects.
          </p>
          <Link
            href="/customer"
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Back to dashboard
          </Link>
        </section>
      </PortalShell>
    );
  }

  const projects = await getCustomerAwardedQuotesForProjects({
    customerId: customer.id,
  });

  return (
    <PortalShell
      workspace="customer"
      title="Projects"
      subtitle="Awarded jobs in progress and history."
    >
      <PortalCard
        title="Awarded projects"
        description="These are RFQs that have been awarded and are now tracked as projects."
      >
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-black/40 px-4 py-6 text-sm text-slate-300">
            <p className="font-medium text-slate-100">No awarded projects yet.</p>
            <p className="mt-1 text-slate-400">
              When you award a winning supplier on a quote, it will show up here as a project.
            </p>
            <div className="mt-4">
              <Link
                href="/customer/quotes"
                className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                View quotes
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-900/70 bg-black/40">
            <table className="min-w-full divide-y divide-slate-900/70 text-sm">
              <thead className="bg-slate-900/60">
                <tr>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Project
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Supplier
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Awarded
                  </th>
                  <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Kickoff
                  </th>
                  <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/70">
                {projects.map((project) => {
                  const supplierLabel = project.supplierName?.trim()
                    ? project.supplierName
                    : "Supplier pending";
                  const kickoff = formatKickoffStatus(project.kickoff);

                  return (
                    <tr key={project.id} className="hover:bg-slate-900/50">
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-100">
                            {project.projectName}
                          </span>
                          <span className="text-xs text-slate-500">
                            Quote {project.id.startsWith("Q-") ? project.id : `#${project.id.slice(0, 6)}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-200">
                        {supplierLabel}
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-300">
                        {formatAwardedDate(project.awardedAt)}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="space-y-1">
                          <p className={clsx("font-medium", kickoff.tone)}>{kickoff.label}</p>
                          <p className="text-xs text-slate-400">
                            {kickoff.detail} tasks completed
                          </p>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-right">
                        <Link
                          href={`/customer/quotes/${project.id}`}
                          className="inline-flex min-w-[7.5rem] items-center justify-center rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-emerald-400"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PortalCard>
    </PortalShell>
  );
}

