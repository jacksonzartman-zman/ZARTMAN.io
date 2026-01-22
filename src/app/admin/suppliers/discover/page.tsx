import clsx from "clsx";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { requireAdminUser } from "@/server/auth";
import { normalizeSearchParams } from "@/lib/route/normalizeSearchParams";
import { assessDiscoveryCompleteness } from "@/lib/provider/discoveryCompleteness";
import {
  loadAdminSupplierDiscovery,
  type AdminSupplierDiscoveryRow,
} from "@/server/admin/supplierDiscovery";
import { discoverSupplierAction, updateSupplierDiscoveryAction } from "@/app/admin/suppliers/discover/actions";
import Link from "next/link";
import { getProviderWithContactById, type ProviderContactRow, type ProviderEmailColumn } from "@/server/providers";

export const dynamic = "force-dynamic";

type FilterReputation =
  | "all"
  | "excellent"
  | "good"
  | "fair"
  | "limited"
  | "unknown";

function parseReputationFilter(value: unknown): FilterReputation {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "excellent" ||
    normalized === "good" ||
    normalized === "fair" ||
    normalized === "limited" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return "all";
}

function formatReputationLabel(value: AdminSupplierDiscoveryRow["reputationLabel"]): string {
  switch (value) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "limited":
      return "Limited";
    default:
      return "Unknown";
  }
}

function reputationPillClasses(value: AdminSupplierDiscoveryRow["reputationLabel"]): string {
  switch (value) {
    case "excellent":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "good":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "fair":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "limited":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-800 bg-slate-950/60 text-slate-200";
  }
}

function formatWinRate(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 10) / 10}%`;
}

export default async function AdminSupplierDiscoveryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser({ redirectTo: "/login" });

  const usp = normalizeSearchParams(searchParams ? await searchParams : undefined);
  const reputationFilter = parseReputationFilter(usp.get("reputation"));
  const created = usp.get("created") === "1";
  const providerId = typeof usp.get("providerId") === "string" ? usp.get("providerId") : null;
  const editProviderId =
    typeof usp.get("editProviderId") === "string" ? usp.get("editProviderId") : null;
  const updated = usp.get("updated") === "1";
  const hasError = usp.get("error") === "1" || usp.get("error") === "missing";

  const editProviderResult = editProviderId ? await getProviderWithContactById(editProviderId) : null;
  const editProvider = editProviderResult?.provider ?? null;
  const editEmailColumn = editProviderResult?.emailColumn ?? null;
  const editValues = editProvider ? buildEditStubValues(editProvider, editEmailColumn) : null;

  const allRows = await loadAdminSupplierDiscovery();
  const filtered = allRows.filter((row) => {
    if (reputationFilter !== "all" && row.reputationLabel !== reputationFilter) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const sa = typeof a.reputationScore === "number" ? a.reputationScore : -1;
    const sb = typeof b.reputationScore === "number" ? b.reputationScore : -1;
    if (sb !== sa) return sb - sa;
    return (a.supplierName ?? "").localeCompare(b.supplierName ?? "");
  });

  const isEmpty = filtered.length === 0;

  return (
    <AdminDashboardShell
      title="Discover suppliers"
      description="Capture a new supplier lead and keep the provider pipeline moving."
    >
      {editProviderId ? (
        <section className="mb-5 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Edit discovered provider stub</h2>
              <p className="mt-1 text-sm text-slate-400">
                Fill missing details so this discovered supplier can move to ready-to-contact.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Link
                href="/admin/providers/pipeline?source=discovered"
                className="rounded-full border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
              >
                Back to pipeline
              </Link>
              <Link
                href="/admin/suppliers/discover"
                className="rounded-full border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
              >
                Clear edit mode
              </Link>
            </div>
          </div>

          {updated ? (
            <div
              className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
              role="status"
            >
              Supplier discovery updated.
            </div>
          ) : null}

          {hasError ? (
            <div
              className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
              role="alert"
            >
              We couldn&apos;t update this supplier right now. Please confirm required fields and try again.
            </div>
          ) : null}

          {editProvider && editValues ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                <span className="font-mono text-slate-500">providerId: {editProvider.id}</span>
                <span
                  className={clsx(
                    "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                    editValues.discovery.complete
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-100",
                  )}
                >
                  Discovery {editValues.discovery.complete ? "complete" : "incomplete"}
                </span>
                {!editValues.discovery.complete ? (
                  <span className="text-slate-400">
                    Missing: {editValues.discovery.missing.join(" · ")}
                  </span>
                ) : null}
              </div>

              <form action={updateSupplierDiscoveryAction} className="mt-5 grid gap-4 lg:grid-cols-2">
                <input type="hidden" name="provider_id" value={editProvider.id} />
                <label className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Company name
                  </span>
                  <input
                    name="company_name"
                    required
                    defaultValue={editProvider.name ?? ""}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Website (or email)
                  </span>
                  <input
                    name="website"
                    defaultValue={editValues.websiteValue ?? ""}
                    placeholder="https://lambda-precision.com"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-2 lg:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Email (or website)
                  </span>
                  <input
                    name="email"
                    type="email"
                    defaultValue={editValues.emailValue ?? ""}
                    placeholder="ops@lambda-precision.com"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Country (optional)
                  </span>
                  <input
                    name="country"
                    defaultValue={editProvider.country ?? ""}
                    placeholder="US"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    States (optional, comma-separated)
                  </span>
                  <input
                    name="states"
                    defaultValue={Array.isArray(editProvider.states) ? editProvider.states.join(", ") : ""}
                    placeholder="CA, OR"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-2 lg:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Notes (optional)
                  </span>
                  <textarea
                    name="notes"
                    defaultValue={editProvider.notes ?? ""}
                    rows={4}
                    placeholder="Anything ops should know..."
                    className="w-full resize-y rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  />
                </label>

                <div className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-5 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Process tags (required)
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-200">
                    {PROCESS_TAGS.map((tag) => {
                      const checked = editValues.processesSet.has(tag.toLowerCase());
                      return (
                        <label key={tag} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="processes"
                            value={tag}
                            defaultChecked={checked}
                            className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                          />
                          <span>{tag}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-5 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Material tags (optional)
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-200">
                    {MATERIAL_TAGS.map((tag) => {
                      const checked = editValues.materialsSet.has(tag.toLowerCase());
                      return (
                        <label key={tag} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="materials"
                            value={tag}
                            defaultChecked={checked}
                            className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                          />
                          <span>{tag}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Required for completeness: name + (email OR website) + at least 1 process.
                  </p>
                  <button
                    type="submit"
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
                  >
                    Save stub
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="alert">
              We couldn&apos;t find that provider. Try opening it again from the pipeline.
            </div>
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <h2 className="text-base font-semibold text-white">New supplier lead</h2>
        <p className="mt-1 text-sm text-slate-400">
          Creates an inactive, unverified provider stub with source set to discovered and hidden from the directory.
        </p>

        {created ? (
          <div
            className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
            role="status"
          >
            <p className="font-semibold">Supplier discovered.</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <Link
                href="/admin/providers/pipeline?source=discovered"
                className="font-semibold text-emerald-100 underline hover:text-white"
              >
                View discovered providers in pipeline →
              </Link>
              {providerId ? (
                <span className="font-mono text-emerald-200/80">providerId: {providerId}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {hasError ? (
          <div
            className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            role="alert"
          >
            We couldn&apos;t create this supplier right now. Please confirm required fields and try again.
          </div>
        ) : null}

        <form action={discoverSupplierAction} className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Company name
            </span>
            <input
              name="company_name"
              required
              placeholder="Lambda Precision"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Website
            </span>
            <input
              name="website"
              required
              placeholder="https://lambda-precision.com"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2 lg:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Email (optional)
            </span>
            <input
              name="email"
              type="email"
              placeholder="ops@lambda-precision.com"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Process tags
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-200">
              {PROCESS_TAGS.map((tag) => (
                <label key={tag} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="processes"
                    value={tag}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                  />
                  <span>{tag}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Material tags
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-200">
              {MATERIAL_TAGS.map((tag) => (
                <label key={tag} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="materials"
                    value={tag}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                  />
                  <span>{tag}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Tip: tags are saved as lowercase to match capability scoring.
            </p>
            <button
              type="submit"
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
            >
              Create discovered provider
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-5">
        <form
          method="GET"
          action="/admin/suppliers/discover"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Reputation (discovery dashboard)
            </span>
            <select
              name="reputation"
              defaultValue={reputationFilter === "all" ? "" : reputationFilter}
              className="w-full min-w-56 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="">All</option>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="limited">Limited</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <button
            type="submit"
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            Apply
          </button>
        </form>
      </section>

      <AdminTableShell
        className="mt-5"
        head={
          <tr>
            <th className="px-5 py-4">Supplier</th>
            <th className="px-5 py-4">Reputation</th>
            <th className="px-5 py-4">Match</th>
            <th className="px-5 py-4">Bench</th>
            <th className="px-5 py-4">RFQs (90d)</th>
            <th className="px-5 py-4">Win rate (90d)</th>
          </tr>
        }
        body={
          isEmpty ? (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-base text-slate-300">
                <p className="font-medium text-slate-100">No suppliers match this filter yet</p>
                <p className="mt-2 text-sm text-slate-400">
                  Try clearing filters to see the full supplier list.
                </p>
              </td>
            </tr>
          ) : (
            filtered.map((row) => (
              <tr
                key={row.supplierId}
                className="bg-slate-950/40 transition hover:bg-slate-900/40"
              >
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-100")}>
                  <div className="space-y-1">
                    <p className="font-medium text-slate-100">{row.supplierName}</p>
                    <p className="font-mono text-[11px] text-slate-500">{row.supplierId}</p>
                  </div>
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        reputationPillClasses(row.reputationLabel),
                      )}
                    >
                      {formatReputationLabel(row.reputationLabel)}
                    </span>
                    <span className="text-xs text-slate-300 tabular-nums">
                      {typeof row.reputationScore === "number" ? `${row.reputationScore}/100` : "—"}
                    </span>
                  </div>
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {row.matchHealth}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {row.benchStatus}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {row.rfqsConsidered} / {row.rfqsBid} / {row.rfqsWon}
                </td>
                <td className={clsx(adminTableCellClass, "px-5 py-4 text-slate-200")}>
                  {formatWinRate(row.winRatePct)}
                </td>
              </tr>
            ))
          )
        }
      />
    </AdminDashboardShell>
  );
}

const PROCESS_TAGS = [
  "CNC machining",
  "Sheet metal",
  "Fabrication",
  "3D printing",
  "Injection molding",
  "Casting",
  "Finishing",
] as const;

const MATERIAL_TAGS = [
  "Aluminum",
  "Stainless steel",
  "Steel",
  "Titanium",
  "Copper",
  "Brass",
  "Plastics",
  "Nylon",
  "ABS",
  "Delrin",
] as const;

function buildEditStubValues(provider: ProviderContactRow, emailColumn: ProviderEmailColumn | null): {
  emailValue: string | null;
  websiteValue: string | null;
  discovery: ReturnType<typeof assessDiscoveryCompleteness>;
  processesSet: Set<string>;
  materialsSet: Set<string>;
} {
  const notesValue = normalizeOptionalText(provider.notes);
  const rawEmailValue = readEmailValue(provider, emailColumn);
  const rawWebsiteValue = normalizeOptionalText(provider.website);
  const rfqUrlValue = normalizeOptionalText(provider.rfq_url);
  const emailValue = rawEmailValue ?? extractInviteDetail(notesValue, "Invited email:");
  const websiteValue =
    rawWebsiteValue ?? extractInviteDetail(notesValue, "Invited website:") ?? rfqUrlValue;

  const processes = Array.isArray(provider.processes) ? provider.processes : [];
  const materials = Array.isArray(provider.materials) ? provider.materials : [];
  const processesSet = new Set(processes.map((value) => (typeof value === "string" ? value.toLowerCase() : "")));
  const materialsSet = new Set(materials.map((value) => (typeof value === "string" ? value.toLowerCase() : "")));

  const discovery = assessDiscoveryCompleteness({
    name: provider.name,
    email: emailValue,
    website: websiteValue,
    processes,
  });

  return {
    emailValue,
    websiteValue,
    discovery,
    processesSet,
    materialsSet,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEmailValue(provider: ProviderContactRow, column: ProviderEmailColumn | null): string | null {
  if (!column) return null;
  const raw = provider[column];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function extractInviteDetail(
  notes: string | null,
  prefix: "Invited email:" | "Invited website:",
): string | null {
  if (!notes) return null;
  const lines = notes.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim();
      return value || null;
    }
  }
  return null;
}

