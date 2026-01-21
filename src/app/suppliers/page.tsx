export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import { SHOW_SUPPLIER_DIRECTORY_PUBLIC } from "@/lib/ui/deprecation";
import {
  loadPublicSuppliersDirectory,
  type PublicSupplierDirectoryRow,
} from "@/server/suppliers/publicDirectory";

const REQUEST_QUOTE_HREF = "/customer/search";
const INVITE_SUPPLIER_HREF = "/customer/invite-supplier";
const BECOME_SUPPLIER_HREF = "/suppliers/join";

const tagClasses =
  "inline-flex items-center rounded-full border border-slate-800/70 bg-slate-900/40 px-3 py-1 text-xs font-semibold text-ink-soft";
const unverifiedBadgeClasses =
  "inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100";
const inactiveBadgeClasses =
  "inline-flex items-center rounded-full border border-slate-500/40 bg-slate-800/40 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100";
const invitedBadgeClasses =
  "inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-100";
const unverifiedNote =
  "Listing is informational. Request an introduction to work with this supplier.";
const inactiveNote =
  "Listing is informational. This supplier is currently inactive; request an introduction to confirm availability.";
const invitedExplanation =
  "Invited suppliers are pending verification and are not available for instant quotes. Request an introduction to work with them.";
const COVERAGE_TAG_LIMIT = 12;
const INVITED_SUPPLIER_THRESHOLD = 12;
const INVITED_SOURCES = new Set(["customer_invite", "csv_import"]);

function getCapabilityTags(row: PublicSupplierDirectoryRow): string[] {
  const combined = [...row.materials, ...row.certifications];
  return Array.from(new Set(combined));
}

function normalizeCoverageValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildCoverageList(values: Array<string | null | undefined>): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeCoverageValue(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, normalized);
    }
  }
  return Array.from(unique.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function isInvitedPendingSupplier(supplier: PublicSupplierDirectoryRow): boolean {
  const source = supplier.source ?? "";
  const normalizedSource = source.trim().toLowerCase();
  if (!INVITED_SOURCES.has(normalizedSource)) return false;
  return (!supplier.isVerified || !supplier.isActive) && supplier.showInDirectory;
}

function TagList({
  items,
  emptyLabel,
  max = 4,
}: {
  items: string[];
  emptyLabel: string;
  max?: number;
}) {
  if (items.length === 0) {
    return <span className="text-sm text-ink-muted">{emptyLabel}</span>;
  }

  const visible = items.slice(0, max);
  const remaining = items.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((item) => (
        <span key={item} className={tagClasses}>
          {item}
        </span>
      ))}
      {remaining > 0 ? <span className="text-xs text-ink-soft">+{remaining} more</span> : null}
    </div>
  );
}

export default async function SuppliersDirectoryPage() {
  if (!SHOW_SUPPLIER_DIRECTORY_PUBLIC) {
    notFound();
  }

  const suppliers = await loadPublicSuppliersDirectory();
  const verifiedSuppliers = suppliers.filter(
    (supplier) => supplier.isVerified && supplier.isActive && supplier.showInDirectory,
  );
  const coverageProcesses = buildCoverageList(
    verifiedSuppliers.flatMap((supplier) => supplier.processes),
  );
  const coverageLocations = buildCoverageList(
    verifiedSuppliers.map((supplier) => supplier.location),
  );
  const invitedSuppliers = suppliers.filter(isInvitedPendingSupplier);
  const invitedSupplierIds = new Set(invitedSuppliers.map((supplier) => supplier.supplierId));
  const directorySuppliers = suppliers.filter(
    (supplier) => !invitedSupplierIds.has(supplier.supplierId),
  );
  const shouldShowInvitedSuppliers =
    verifiedSuppliers.length < INVITED_SUPPLIER_THRESHOLD && invitedSuppliers.length > 0;
  const invitedSuppliersToShow = shouldShowInvitedSuppliers ? invitedSuppliers : [];
  const isEmpty = directorySuppliers.length === 0;

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 py-16 sm:px-6 lg:px-8 sm:py-20 space-y-14">
        <section className="space-y-6 max-w-4xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            Supplier directory
          </p>
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
              Browse suppliers by process, location, and capability.
            </h1>
            <p className="text-base text-ink-muted heading-snug">
              Verified suppliers are vetted and updated by the Zartman team. Coverage areas below reflect
              verified, active suppliers.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={REQUEST_QUOTE_HREF} className={primaryCtaClasses}>
              Search suppliers
            </Link>
            {SHOW_SUPPLIER_DIRECTORY_PUBLIC ? (
              <Link href={BECOME_SUPPLIER_HREF} className={secondaryCtaClasses}>
                Join as a supplier
              </Link>
            ) : null}
          </div>
        </section>

        <section className="space-y-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-ink heading-tight">Coverage areas</h2>
              <p className="text-sm text-ink-muted">
                Processes and locations represented by verified suppliers.
              </p>
            </div>
            <span className="text-xs text-ink-soft">
              {verifiedSuppliers.length} verified supplier
              {verifiedSuppliers.length === 1 ? "" : "s"}
            </span>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">Processes</p>
              <div className="mt-3">
                <TagList
                  items={coverageProcesses}
                  emptyLabel="Coverage details are updating."
                  max={COVERAGE_TAG_LIMIT}
                />
              </div>
            </article>
            <article className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">Locations</p>
              <div className="mt-3">
                <TagList
                  items={coverageLocations}
                  emptyLabel="Location coverage is updating."
                  max={COVERAGE_TAG_LIMIT}
                />
              </div>
            </article>
          </div>
        </section>

        <section className="space-y-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-ink heading-tight">Directory</h2>
              <p className="text-sm text-ink-muted">
                Click a supplier to view their process coverage and certifications.
              </p>
            </div>
            <span className="text-xs text-ink-soft">
              {directorySuppliers.length} supplier{directorySuppliers.length === 1 ? "" : "s"}
            </span>
          </header>

          {isEmpty ? (
            <div className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 text-sm text-ink-muted">
              The directory is currently being curated. Search suppliers to get matched with the right
              partners for your project.
            </div>
          ) : (
            <div className="grid gap-4">
              {directorySuppliers.map((supplier) => {
                const capabilityTags = getCapabilityTags(supplier);
                const isInstantQuoteReady =
                  supplier.isVerified && supplier.isActive && supplier.showInDirectory;
                const supplierCtaHref = isInstantQuoteReady
                  ? `/suppliers/${supplier.slug}`
                  : INVITE_SUPPLIER_HREF;
                const supplierCtaLabel = isInstantQuoteReady
                  ? "View profile"
                  : "Request introduction";
                return (
                  <article
                    key={supplier.supplierId}
                    className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_14px_40px_rgba(2,6,23,0.35)]"
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/suppliers/${supplier.slug}`}
                            className="text-lg font-semibold text-emerald-100 hover:text-emerald-200"
                          >
                            {supplier.supplierName}
                          </Link>
                          {!supplier.isVerified ? (
                            <span className={unverifiedBadgeClasses}>Unverified</span>
                          ) : null}
                          {!supplier.isActive ? (
                            <span className={inactiveBadgeClasses}>Inactive</span>
                          ) : null}
                        </div>
                        <span className="text-sm text-ink-soft">
                          {supplier.location ?? "Location shared during request"}
                        </span>
                        {!supplier.isVerified ? (
                          <p className="text-xs text-amber-100/80">{unverifiedNote}</p>
                        ) : null}
                        {!supplier.isActive ? (
                          <p className="text-xs text-slate-200/80">{inactiveNote}</p>
                        ) : null}
                      </div>

                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
                            Process
                          </p>
                          <TagList items={supplier.processes} emptyLabel="Processes shared on request" />
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
                            Location
                          </p>
                          <p className="text-sm text-ink-muted">
                            {supplier.location ?? "Location shared during request"}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
                            Capabilities
                          </p>
                          <TagList items={capabilityTags} emptyLabel="Capabilities shared on request" />
                        </div>
                      </div>

                      <div>
                        <Link
                          href={supplierCtaHref}
                          className="text-sm font-semibold text-emerald-200 hover:text-emerald-100"
                        >
                          {supplierCtaLabel} <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {shouldShowInvitedSuppliers ? (
          <section className="space-y-5">
            <header className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-ink heading-tight">
                  Invited suppliers (pending verification)
                </h2>
                <span className="text-xs text-ink-soft">
                  {invitedSuppliersToShow.length} invited supplier
                  {invitedSuppliersToShow.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-sm text-ink-muted">{invitedExplanation}</p>
            </header>
            <div className="grid gap-4">
              {invitedSuppliersToShow.map((supplier) => (
                <article
                  key={supplier.supplierId}
                  className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_14px_40px_rgba(2,6,23,0.35)]"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/suppliers/${supplier.slug}`}
                          className="text-lg font-semibold text-emerald-100 hover:text-emerald-200"
                        >
                          {supplier.supplierName}
                        </Link>
                        <span className={invitedBadgeClasses}>Invited (pending verification)</span>
                      </div>
                      <span className="text-sm text-ink-soft">
                        {supplier.location ?? "Location shared during request"}
                      </span>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
                          Process
                        </p>
                        <TagList items={supplier.processes} emptyLabel="Processes shared on request" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
                          Location
                        </p>
                        <p className="text-sm text-ink-muted">
                          {supplier.location ?? "Location shared during request"}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
                          Capabilities
                        </p>
                        <TagList
                          items={getCapabilityTags(supplier)}
                          emptyLabel="Capabilities shared on request"
                        />
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
