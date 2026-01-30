import Link from "next/link";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers/profile";
import {
  countUniqueSupplierProcessesFromCapabilities,
  getUniqueSupplierProcessesFromCapabilities,
} from "@/lib/supplier/processes";
import { submitSupplierProcessesSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const PROCESS_OPTIONS = ["CNC", "Sheet metal", "MJF", "FDM", "SLA", "Injection molding"] as const;

type SupplierProcessesSettingsPageProps = {
  searchParams?: Promise<{ saved?: string | string[]; error?: string | string[] }>;
};

export default async function SupplierProcessesSettingsPage({
  searchParams,
}: SupplierProcessesSettingsPageProps) {
  const user = await requireUser({ redirectTo: "/supplier/settings/processes" });
  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;
  const capabilities = profile?.capabilities ?? [];

  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Processes"
        subtitle="Keep your manufacturing processes current so we can route better matched RFQs."
        actions={
          <Link
            href="/supplier/settings"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
          >
            Back to settings
          </Link>
        }
      >
        <PortalCard
          title="Finish onboarding"
          description="Complete onboarding before selecting supported processes."
        >
          <Link
            href="/supplier/onboarding"
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            Complete onboarding
          </Link>
        </PortalCard>
      </PortalShell>
    );
  }

  const resolved = searchParams ? await searchParams : undefined;
  const saved = coerceSingleParam(resolved?.saved);
  const error = coerceSingleParam(resolved?.error);

  const selectedProcesses = getUniqueSupplierProcessesFromCapabilities(capabilities);
  const selectedCount = countUniqueSupplierProcessesFromCapabilities(capabilities);
  const selectedKeys = new Set(selectedProcesses.map((p) => p.trim().toLowerCase()));
  const showCompletionHint = selectedCount < 2;

  return (
    <PortalShell
      workspace="supplier"
      title="Processes"
      subtitle="Keep your manufacturing processes current so we can route better matched RFQs."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/supplier/settings"
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            Back to settings
          </Link>
          <Link
            href="/supplier"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
          >
            Dashboard
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {saved === "1" ? (
          <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100">
            Processes saved.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-100">
            {error}
          </p>
        ) : null}

        {showCompletionHint ? (
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-slate-100">
            <p className="font-semibold">
              Complete your profile to receive better matched RFQs.
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Select at least two processes so we can confidently route the right work to your inbox.
            </p>
          </div>
        ) : null}

        <PortalCard
          title="Supported processes"
          description="Choose the processes you actively quote today."
        >
          <form action={submitSupplierProcessesSettingsAction} className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              {PROCESS_OPTIONS.map((process) => {
                const key = process.toLowerCase();
                return (
                  <label
                    key={process}
                    className="flex items-center justify-between gap-4 rounded-xl bg-slate-950/20 px-4 py-3 ring-1 ring-slate-800/50"
                  >
                    <span className="text-sm font-semibold text-slate-100">{process}</span>
                    <input
                      type="checkbox"
                      name="processes"
                      value={process}
                      defaultChecked={selectedKeys.has(key)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950/60 text-blue-400"
                    />
                  </label>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/supplier/settings"
                className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
              >
                Back to settings
              </Link>
              <button
                type="submit"
                className="inline-flex items-center rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
              >
                Save processes
              </button>
            </div>
          </form>
        </PortalCard>
      </div>
    </PortalShell>
  );
}

function coerceSingleParam(value?: string | string[]): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

