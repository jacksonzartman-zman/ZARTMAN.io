import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import PortalCard from "../PortalCard";
import { PortalLoginPanel } from "../PortalLoginPanel";
import { WorkspaceWelcomeBanner } from "../WorkspaceWelcomeBanner";
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
  const sessionCompanyName =
    sanitizeDisplayName(session.user.user_metadata?.company) ??
    sanitizeDisplayName(session.user.user_metadata?.full_name) ??
    sanitizeDisplayName(session.user.email) ??
    "your team";
  const supplierEmail = normalizeEmailInput(session.user.email ?? null);
  const onboardingJustCompleted =
    getSearchParamValue(searchParams, "onboard") === "1";

  if (!supplierEmail) {
    return (
      <div className="space-y-6">
        <WorkspaceWelcomeBanner
          role="supplier"
          companyName={sessionCompanyName}
        />
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6 text-center">
          <p className="text-sm text-slate-300">
            Sign in with a verified supplier email address to load your workspace.
          </p>
        </section>
      </div>
    );
  }

  const profile = await loadSupplierProfile(supplierEmail);
  const supplier = profile?.supplier ?? null;
  const capabilities = profile?.capabilities ?? [];
  const documents = profile?.documents ?? [];

  let matches: SupplierQuoteMatch[] = [];
  let bids: SupplierBidWithContext[] = [];
  if (supplier) {
    [matches, bids] = await Promise.all([
      matchQuotesToSupplier(supplier.id),
      listSupplierBidsForSupplier(supplier.id),
    ]);
  }

  const signedInEmail = supplier?.primary_email ?? supplierEmail;
  const companyLabel =
    supplier?.company_name ?? supplier?.primary_email ?? supplierEmail;
  const workspaceCompanyName =
    sanitizeDisplayName(supplier?.company_name) ??
    sanitizeDisplayName(companyLabel) ??
    sessionCompanyName;

  return (
    <div className="space-y-6">
      <WorkspaceWelcomeBanner
        role="supplier"
        companyName={workspaceCompanyName}
      />
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-300">
          Supplier workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">
          RFQs, bids, and compliance docs in one place
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Review matched RFQs, submit bids, and keep your onboarding profile current without leaving
          this dashboard.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>
            Signed in as{" "}
            <span className="font-semibold text-white">{companyLabel}</span>{" "}
            (<span className="font-mono text-slate-200">{signedInEmail}</span>)
          </span>
          <span>
            Every “View quote” link below carries your identity so we can confirm assignments
            automatically.
          </span>
        </div>
        {onboardingJustCompleted ? (
          <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            Profile updated! We’ll start routing matched RFQs to you automatically.
          </p>
        ) : null}
      </section>

      <OnboardingPromptCard supplierExists={Boolean(supplier)} />

      <ProfileCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        supplier={supplier}
        capabilities={capabilities}
        documents={documents}
      />

      <MatchesCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        supplierExists={Boolean(supplier)}
        matches={matches}
      />

      <BidsCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        bids={bids}
      />
    </div>
  );
}

function OnboardingPromptCard({
  supplierExists,
}: {
  supplierExists: boolean;
}) {
  return (
    <PortalCard
      title="Finish supplier onboarding"
      description="Share your shop profile once so we know which RFQs, bids, and compliance docs belong to you."
      action={
        <Link href="/supplier/onboarding" className={primaryCtaClasses}>
          {supplierExists ? "Update profile" : "Finish onboarding"}
        </Link>
      }
    >
      <div className="space-y-3 text-sm text-slate-300">
        <p>
          We’ll keep using the same email-only magic link to confirm it’s you. Once the form is
          complete, matched RFQs and compliance requests unlock automatically.
        </p>
        {supplierExists ? (
          <p className="text-xs text-slate-500">
            Need to tweak capabilities or certs? Re-open the onboarding form any time and your
            workspace stays in sync.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Add capabilities, certifications, and documents so we can auto-route RFQs to your inbox.
          </p>
        )}
      </div>
    </PortalCard>
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
          ? "Keep company details, capabilities, and compliance docs current so RFQ matches stay accurate."
          : "Complete onboarding so customers see verified company info."
      }
      action={
        <Link
          href="/supplier/onboarding"
          className={secondaryCtaClasses}
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
          ? "RFQs that match your verified processes, certifications, and compliance documents."
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
        <div className="rounded-2xl border border-dashed border-slate-800/70 bg-black/20 px-4 py-4 text-sm text-slate-400">
          No matches yet. We’ll email you as soon as there’s a fit and list the RFQ here.
        </div>
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
      title="Submitted bids"
      description="Track the quotes you’ve priced and see where each bid stands."
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
        <div className="rounded-2xl border border-dashed border-slate-800/70 bg-black/20 px-4 py-4 text-sm text-slate-400">
          No bids yet. Open a matched RFQ above to submit pricing, lead time, and certs — we’ll track
          the status here once you send it.
        </div>
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

function sanitizeDisplayName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof SupplierDashboardPage>;

export default SupplierDashboardPage as unknown as NextAppPage;
