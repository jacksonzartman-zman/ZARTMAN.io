import type { ReactNode } from "react";
import Link from "next/link";
import { primaryCtaClasses } from "@/lib/ctas";
import PortalCard from "../../PortalCard";
import type { SupplierProfile, SupplierApprovalStatus } from "@/server/suppliers";

export type SupplierProfileCardProps = {
  supplier: SupplierProfile["supplier"] | null;
  capabilities: SupplierProfile["capabilities"];
  documents: SupplierProfile["documents"];
  approvalsEnabled: boolean;
  approvalStatus: SupplierApprovalStatus;
};

export function SupplierProfileCard({
  supplier,
  capabilities,
  documents,
  approvalsEnabled,
  approvalStatus,
}: SupplierProfileCardProps) {
  const hasProfile = Boolean(supplier);

  return (
    <PortalCard
      title="Supplier profile"
      description={
        hasProfile
          ? "Keep company details, capabilities, and compliance docs current so search request matches stay accurate."
          : "Complete onboarding so customers see verified company info."
      }
      action={
        <Link href="/supplier/onboarding" className={primaryCtaClasses}>
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
                approvalsEnabled
                  ? approvalStatus === "approved"
                    ? (
                        <span className="text-emerald-200">Approved marketplace supplier</span>
                      )
                    : approvalStatus === "rejected"
                      ? (
                          <span className="text-red-200">Review required</span>
                        )
                      : (
                          <span className="text-amber-200">Pending review</span>
                        )
                  : supplier?.verified
                      ? (
                          <span className="text-emerald-200">Verified marketplace supplier</span>
                        )
                      : "Pending review"
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
                    <p className="text-sm font-semibold text-white">{capability.process}</p>
                    <p className="text-xs text-slate-400">
                      Materials: {(capability.materials ?? []).join(", ") || "Not provided"}
                    </p>
                    <p className="text-xs text-slate-400">
                      Certs: {(capability.certifications ?? []).join(", ") || "Not provided"}
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
              <p className="mt-2 text-xs text-slate-400">No compliance documents uploaded yet.</p>
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

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-900/70 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm text-slate-100">{value}</p>
    </div>
  );
}
