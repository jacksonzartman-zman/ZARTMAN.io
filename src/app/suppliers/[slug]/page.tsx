export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import { SHOW_SUPPLIER_DIRECTORY_PUBLIC } from "@/lib/ui/deprecation";
import {
  extractSupplierIdFromSlug,
  loadPublicSupplierById,
} from "@/server/suppliers/publicDirectory";

const REQUEST_QUOTE_HREF = "/customer/search";
const INVITE_SUPPLIER_HREF = "/customer/invite-supplier";

const tagClasses =
  "inline-flex items-center rounded-full border border-slate-800/70 bg-slate-900/40 px-3 py-1 text-xs font-semibold text-ink-soft";
const unverifiedBadgeClasses =
  "inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100";
const inactiveBadgeClasses =
  "inline-flex items-center rounded-full border border-slate-500/40 bg-slate-800/40 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100";
const unverifiedNote =
  "Listing is informational. Request an introduction to work with this supplier.";
const inactiveNote =
  "Listing is informational. This supplier is currently inactive; request an introduction to confirm availability.";

type Props = {
  params: { slug: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

function TagList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <span className="text-sm text-ink-muted">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <span key={item} className={tagClasses}>
          {item}
        </span>
      ))}
    </div>
  );
}

export default async function SupplierProfilePage(props: any) {
  const { params } = props as Props;
  if (!SHOW_SUPPLIER_DIRECTORY_PUBLIC) {
    notFound();
  }

  const supplierId = extractSupplierIdFromSlug(params.slug);
  if (!supplierId) {
    notFound();
  }

  const supplier = await loadPublicSupplierById(supplierId);
  if (!supplier) {
    notFound();
  }
  const needsInviteFlow = !supplier.isVerified || !supplier.isActive;
  const primaryCtaHref = needsInviteFlow ? INVITE_SUPPLIER_HREF : REQUEST_QUOTE_HREF;
  const primaryCtaLabel = needsInviteFlow ? "Request introduction" : "Search suppliers";
  const summaryCopy = needsInviteFlow
    ? "Review process coverage, location, and capabilities before requesting an introduction."
    : "Review process coverage, location, and capabilities before starting a supplier search.";
  const calloutCopy = needsInviteFlow
    ? "Want to work with this supplier? Request an introduction and we'll follow up after they verify."
    : "Need a supplier match fast? Start a supplier search and we'll review your RFQ before routing it to the best-fit shops.";

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 py-16 sm:px-6 lg:px-8 sm:py-20 space-y-12">
        <section className="space-y-6 max-w-4xl">
          {SHOW_SUPPLIER_DIRECTORY_PUBLIC ? (
            <Link
              href="/suppliers"
              className="text-sm font-semibold text-emerald-200 hover:text-emerald-100"
            >
              &lt;- Back to directory
            </Link>
          ) : null}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
              Supplier profile
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
                {supplier.supplierName}
              </h1>
              {!supplier.isVerified ? (
                <span className={unverifiedBadgeClasses}>Unverified</span>
              ) : null}
              {!supplier.isActive ? (
                <span className={inactiveBadgeClasses}>Inactive</span>
              ) : null}
            </div>
            <p className="text-base text-ink-muted heading-snug">{summaryCopy}</p>
            {!supplier.isVerified ? (
              <p className="text-sm text-amber-100/80">{unverifiedNote}</p>
            ) : null}
            {!supplier.isActive ? (
              <p className="text-sm text-slate-200/80">{inactiveNote}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={primaryCtaHref} className={primaryCtaClasses}>
              {primaryCtaLabel}
            </Link>
            {SHOW_SUPPLIER_DIRECTORY_PUBLIC ? (
              <Link href="/suppliers" className={secondaryCtaClasses}>
                Browse directory
              </Link>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_15px_45px_rgba(2,6,23,0.4)]">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">Process</p>
            <div className="mt-3">
              <TagList items={supplier.processes} emptyLabel="Processes shared on request" />
            </div>
          </article>

          <article className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_15px_45px_rgba(2,6,23,0.4)]">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">Location</p>
            <p className="mt-3 text-sm text-ink-muted">
              {supplier.location ?? "Location shared during request"}
            </p>
          </article>

          <article className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_15px_45px_rgba(2,6,23,0.4)]">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">Capabilities</p>
            <div className="mt-3 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">Materials</p>
                <TagList items={supplier.materials} emptyLabel="Materials shared on request" />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">Certifications</p>
                <TagList items={supplier.certifications} emptyLabel="Certifications shared on request" />
              </div>
            </div>
          </article>
        </section>

        <section className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 text-sm text-ink-muted">
          {calloutCopy}
        </section>
      </div>
    </main>
  );
}
