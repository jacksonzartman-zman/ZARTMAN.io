import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import PortalCard from "../PortalCard";
import { PortalLoginPanel } from "../PortalLoginPanel";
import {
  getSearchParamValue,
  normalizeEmailInput,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import {
  listSupplierBidsForSupplier,
  loadSupplierProfile,
  matchQuotesToSupplier,
  type SupplierBidWithContext,
  type SupplierQuoteMatch,
  type SupplierProfile,
} from "@/server/suppliers";
import { getCurrentSession } from "@/server/auth";

export const dynamic = "force-dynamic";

type SupplierDashboardPageProps = {
  searchParams?: SearchParamsLike;
};

async function SupplierDashboardPage({
  searchParams,
}: SupplierDashboardPageProps) {
  const session = await getCurrentSession();
  if (!session) {
    return <PortalLoginPanel role="supplier" fallbackRedirect="/supplier" />;
  }
  const supplierEmail = normalizeEmailInput(session.user.email ?? null);
  const onboardingJustCompleted =
    getSearchParamValue(searchParams, "onboard") === "1";

  if (!supplierEmail) {
    return (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6 text-center">
        <p className="text-sm text-slate-300">
          Sign in with a verified supplier email address to load your workspace.
        </p>
      </section>
    );
  }

  const profile = await loadSupplierProfile(supplierEmail);
  const supplier = profile?.supplier ?? null;
  const capabilities = profile?.capabilities ?? [];
  const documents = profile?.documents ?? [];

  if (!supplier) {
    return (
      <div className="space-y-6">
        <PortalCard
          title="Supplier onboarding"
          description="Share your capabilities so we can route RFQs to your team."
          action={
            <Link
              href="/supplier/onboarding"
              className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-blue-300 transition hover:border-blue-400 hover:text-blue-200"
            >
              Start onboarding
            </Link>
          }
        >
          <p className="text-sm text-slate-300">
            This account hasn’t completed onboarding yet. Knock out the profile once to unlock RFQ
            matching, bids, and shared messaging.
          </p>
        </PortalCard>
      </div>
    );
  }

  const [matches, bids] = await Promise.all([
    matchQuotesToSupplier(supplier.id),
    listSupplierBidsForSupplier(supplier.id),
  ]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4 text-sm text-slate-300">
        <p>
          Viewing workspace data for{" "}
          <span className="font-semibold text-white">
            {supplier.primary_email ?? supplierEmail}
          </span>
          .
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Every “View quote” link below carries your identity so we can confirm assignments
          automatically.
        </p>
        {onboardingJustCompleted ? (
          <p className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            Thanks — your profile is live! We’ll start routing matched RFQs to you automatically.
          </p>
        ) : null}
      </section>

      <ProfileCard
        supplierEmail={supplier.primary_email ?? supplierEmail}
        supplier={supplier}
        capabilities={capabilities}
        documents={documents}
      />

      <MatchesCard
        supplierEmail={supplier.primary_email ?? supplierEmail}
        supplierExists={Boolean(supplier)}
        matches={matches}
      />

      <BidsCard supplierEmail={supplier.primary_email ?? supplierEmail} bids={bids} />
    </div>
  );
}

function ProfileCard({
  supplier,
  capabilities,
  documents,
  supplierEmail,
}: {
  supplier: SupplierProfile["supplier"] | null;
  capabilities: SupplierProfile["capabilities"];
  documents: SupplierProfile["documents"];
  supplierEmail: string;
}) {
  const hasProfile = Boolean(supplier);
  return (
    <PortalCard
      title="Supplier profile"
      description={
        hasProfile
          ? "Update capabilities and docs anytime to improve RFQ matching."
          : "Complete onboarding so customers see verified company info."
      }
      action={
        <Link
          href="/supplier/onboarding"
          className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-blue-300 transition hover:border-blue-400 hover:text-blue-200"
        >
          {hasProfile ? "Edit profile" : "Start onboarding"}
        </Link>
      }
    >
      {hasProfile ? (
        <div className="space-y-4 text-sm text-slate-200">
          <div className="grid gap-3 md:grid-cols-2">
            <Detail label="Company" value={supplier?.company_name ?? "—"} />
            <Detail label="Primary email" value={supplier?.primary_email ?? "—"} />
            <Detail label="Phone" value={supplier?.phone ?? "—"} />
            <Detail label="Website" value={supplier?.website ?? "—"} />
            <Detail label="Country" value={supplier?.country ?? "—"} />
            <Detail
              label="Status"
              value={
                supplier?.verified ? (
                  <span className="text-emerald-200">Verified marketplace supplier</span>
                ) : (
                  "Pending review"
                )
              }
            />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Capabilities
            </p>
            {capabilities.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {capabilities.map((capability) => (
                  <li
                    key={capability.id}
                    className="rounded-xl border border-slate-900/70 bg-black/20 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-white">
                      {capability.process}
                    </p>
                    <p className="text-xs text-slate-400">
                      Materials:{" "}
                      {(capability.materials ?? []).join(", ") || "Not provided"}
                    </p>
                    <p className="text-xs text-slate-400">
                      Certs:{" "}
                      {(capability.certifications ?? []).join(", ") || "Not provided"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                Add at least one capability so we know which processes to match.
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Documents
            </p>
            {documents.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {documents.slice(0, 4).map((doc) => (
                  <li key={doc.id}>
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-blue-300 underline-offset-4 hover:underline"
                    >
                      {doc.doc_type ?? "Document"}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                No compliance documents uploaded yet.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Complete the onboarding form so we can capture company info, capabilities, and compliance docs.
        </p>
      )}
    </PortalCard>
  );
}

function MatchesCard({
  supplierEmail,
  supplierExists,
  matches,
}: {
  supplierEmail: string;
  supplierExists: boolean;
  matches: SupplierQuoteMatch[];
}) {
  return (
    <PortalCard
      title="Inbound RFQs"
      description={
        supplierExists
          ? "RFQs that match your verified processes and certifications."
          : "Complete onboarding to start receiving filtered RFQs."
      }
    >
      {supplierExists && matches.length > 0 ? (
        <ul className="space-y-3">
          {matches.map((match) => {
            const quote = match.quote;
            const fileCount = (quote.file_names ?? quote.upload_file_names ?? []).length;
            const createdLabel = formatDateTime(match.createdAt, {
              includeTime: false,
            });
            const materialsText =
              match.materialMatches.length > 0
                ? `Materials: ${match.materialMatches.join(", ")}`
                : "Materials: —";
            const priceText =
              typeof quote.price === "number" || typeof quote.price === "string"
                ? formatCurrency(Number(quote.price), quote.currency)
                : "Value pending";
            const filesLabel =
              fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "No files";
            return (
                <li key={quote.id}>
                  <Link
                    href={`/supplier/quotes/${quote.id}`}
                    className="block rounded-2xl border border-slate-900/80 bg-slate-950/40 px-4 py-3 transition hover:border-blue-400/40 hover:bg-slate-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
                  >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {quote.company ?? quote.customer_name ?? "Customer"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {match.processHint ?? "Process TBD"} • {filesLabel} • {priceText}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-blue-200">
                      View quote &rarr;
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    <p>{materialsText}</p>
                    <p>Created {createdLabel ?? "recently"}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        ) : supplierExists ? (
          <p className="text-sm text-slate-400">
            No RFQs matched your latest capabilities yet. We’ll notify you as soon as there’s a fit.
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            Complete onboarding to unlock RFQ matching.
          </p>
        )}
    </PortalCard>
  );
}

function BidsCard({
  supplierEmail,
  bids,
}: {
  supplierEmail: string;
  bids: SupplierBidWithContext[];
}) {
  return (
    <PortalCard
      title="My bids"
      description="Track recent quotes you’ve priced."
    >
      {bids.length > 0 ? (
        <ul className="space-y-3">
          {bids.slice(0, 8).map((bid) => (
            <li
              key={bid.id}
              className="rounded-2xl border border-slate-900/70 bg-black/20 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    Quote {bid.quote_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatCurrency(bid.unit_price, bid.currency)} · Lead time{" "}
                    {bid.lead_time_days ?? "—"} days
                  </p>
                </div>
                <StatusBadge status={bid.status} />
              </div>
                <Link
                  href={`/supplier/quotes/${bid.quote_id}`}
                  className="mt-2 inline-flex text-xs font-semibold text-blue-300 underline-offset-4 hover:underline"
                >
                View workspace
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">
          No bids yet. Open a matched RFQ to submit pricing and track your status.
        </p>
      )}
    </PortalCard>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-900/70 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="text-sm text-slate-100">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    accepted: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    declined: "bg-red-500/10 text-red-200 border-red-500/30",
    withdrawn: "bg-slate-500/10 text-slate-200 border-slate-500/30",
    pending: "bg-blue-500/10 text-blue-200 border-blue-500/30",
  };
  const classes =
    colorMap[status] ?? "bg-slate-500/10 text-slate-200 border-slate-500/30";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${classes}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatCurrency(
  value: number | string | null | undefined,
  currency?: string | null,
): string {
  const numericValue =
    typeof value === "string" ? Number(value) : value;
  if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
    return "Value pending";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency ?? "USD").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(numericValue);
  } catch {
    return `$${numericValue.toFixed(0)}`;
  }
}

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof SupplierDashboardPage>;

export default SupplierDashboardPage as unknown as NextAppPage;
