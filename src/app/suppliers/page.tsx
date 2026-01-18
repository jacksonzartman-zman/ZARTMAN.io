export const dynamic = "force-dynamic";

import Link from "next/link";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import {
  loadPublicSuppliersDirectory,
  type PublicSupplierDirectoryRow,
} from "@/server/suppliers/publicDirectory";

const REQUEST_QUOTE_HREF = "/customer/search";
const BECOME_SUPPLIER_HREF = "/suppliers/join";

const tagClasses =
  "inline-flex items-center rounded-full border border-slate-800/70 bg-slate-900/40 px-3 py-1 text-xs font-semibold text-ink-soft";

function getCapabilityTags(row: PublicSupplierDirectoryRow): string[] {
  const combined = [...row.materials, ...row.certifications];
  return Array.from(new Set(combined));
}

function TagList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <span className="text-sm text-ink-muted">{emptyLabel}</span>;
  }

  const max = 4;
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
  const suppliers = await loadPublicSuppliersDirectory();
  const isEmpty = suppliers.length === 0;

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 py-16 sm:px-6 lg:px-8 sm:py-20 space-y-14">
        <section className="space-y-6 max-w-4xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            Supplier directory
          </p>
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
              Browse vetted suppliers by process, location, and capability.
            </h1>
            <p className="text-base text-ink-muted heading-snug">
              This directory highlights shops we trust for CNC, sheet metal, additive, and light assembly work.
              Every supplier listed here is vetted and updated by the Zartman team.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={REQUEST_QUOTE_HREF} className={primaryCtaClasses}>
              Request quote
            </Link>
            <Link href={BECOME_SUPPLIER_HREF} className={secondaryCtaClasses}>
              Join as a supplier
            </Link>
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
              {suppliers.length} supplier{suppliers.length === 1 ? "" : "s"}
            </span>
          </header>

          {isEmpty ? (
            <div className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 text-sm text-ink-muted">
              The directory is currently being curated. Request a quote to get matched with the right
              suppliers for your project.
            </div>
          ) : (
            <div className="grid gap-4">
              {suppliers.map((supplier) => {
                const capabilityTags = getCapabilityTags(supplier);
                return (
                  <article
                    key={supplier.supplierId}
                    className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_14px_40px_rgba(2,6,23,0.35)]"
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-2">
                        <Link
                          href={`/suppliers/${supplier.slug}`}
                          className="text-lg font-semibold text-emerald-100 hover:text-emerald-200"
                        >
                          {supplier.supplierName}
                        </Link>
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
                          <TagList items={capabilityTags} emptyLabel="Capabilities shared on request" />
                        </div>
                      </div>

                      <div>
                        <Link
                          href={`/suppliers/${supplier.slug}`}
                          className="text-sm font-semibold text-emerald-200 hover:text-emerald-100"
                        >
                          View profile <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
