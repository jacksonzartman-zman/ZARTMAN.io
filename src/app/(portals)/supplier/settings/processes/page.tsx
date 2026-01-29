import Link from "next/link";
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
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
            Supplier workspace
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Processes</h1>
          <p className="mt-2 text-sm text-slate-400">
            Finish supplier onboarding to select the processes your shop supports.
          </p>
          <div className="mt-4">
            <Link
              href="/supplier/onboarding"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              Complete onboarding
            </Link>
          </div>
        </section>
      </div>
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
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
          Supplier workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Processes</h1>
        <p className="mt-2 text-sm text-slate-400">
          Keep your manufacturing processes current so we can route better matched RFQs.
        </p>
      </section>

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
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 px-5 py-4 text-sm text-slate-100">
          <p className="font-semibold">
            Complete your profile to receive better matched RFQs.
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Select at least two processes so we can confidently route the right work to your inbox.
          </p>
        </div>
      ) : null}

      <form
        action={submitSupplierProcessesSettingsAction}
        className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6 space-y-5"
      >
        <div>
          <h2 className="text-lg font-semibold text-white">Supported processes</h2>
          <p className="mt-1 text-sm text-slate-400">
            Choose the processes you actively quote today.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {PROCESS_OPTIONS.map((process) => {
            const key = process.toLowerCase();
            return (
              <label
                key={process}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-900/70 bg-slate-950/40 px-4 py-3"
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
    </div>
  );
}

function coerceSingleParam(value?: string | string[]): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

