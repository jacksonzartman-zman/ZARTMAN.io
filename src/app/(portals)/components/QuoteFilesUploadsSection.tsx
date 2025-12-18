import { CollapsibleCard } from "@/components/CollapsibleCard";
import { QuoteFilesCard, type QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { QuoteUploadsStructuredList } from "@/components/QuoteUploadsStructuredList";
import type { QuoteUploadGroup } from "@/server/quotes/uploadFiles";
import type { QuotePartWithFiles } from "@/app/(portals)/quotes/workspaceData";
import { computePartsCoverage } from "@/lib/quote/partsCoverage";

/**
 * Phase 1 Polish checklist
 * - Done: Empty state (no files) is consistent + calm guidance
 * - Done: Copy normalization ("Uploads")
 */

type QuoteFilesUploadsSectionProps = {
  files: QuoteFileItem[];
  fileCountText: string;
  defaultOpen?: boolean;
  uploadGroups?: QuoteUploadGroup[];
  parts?: QuotePartWithFiles[];
};

export function QuoteFilesUploadsSection({
  files,
  fileCountText,
  defaultOpen = true,
  uploadGroups,
  parts,
}: QuoteFilesUploadsSectionProps) {
  const partsList = Array.isArray(parts) ? parts : [];
  const { perPart, summary } = computePartsCoverage(partsList);

  return (
    <CollapsibleCard
      title="Uploads"
      description="RFQ files and download links."
      defaultOpen={defaultOpen}
      summary={
        <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
          {fileCountText}
        </span>
      }
    >
      <div className="space-y-2">
        {summary.anyParts ? (
          <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Parts
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  {summary.totalParts} part{summary.totalParts === 1 ? "" : "s"} •{" "}
                  {summary.fullyCoveredParts} fully covered
                </p>
              </div>
              <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold text-slate-200">
                Coverage: {summary.allCovered ? "Good" : "Needs attention"}
              </span>
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/30">
              <div className="grid grid-cols-[minmax(0,1.5fr)_90px_105px] gap-3 border-b border-slate-900/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <div>Part</div>
                <div className="text-right">CAD</div>
                <div className="text-right">Drawings</div>
              </div>
              <div className="divide-y divide-slate-900/60">
                {perPart.map((part) => (
                  <div
                    key={part.partId}
                    className="grid grid-cols-[minmax(0,1.5fr)_90px_105px] gap-3 px-4 py-2 text-sm text-slate-200"
                  >
                    <div className="min-w-0 truncate font-medium text-slate-100">
                      {part.partNumber ? `${part.partLabel} (${part.partNumber})` : part.partLabel}
                    </div>
                    <div className="text-right tabular-nums">{part.cadCount}</div>
                    <div className="text-right tabular-nums">{part.drawingCount}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}
        {uploadGroups && uploadGroups.length > 0 ? (
          <QuoteUploadsStructuredList uploadGroups={uploadGroups} />
        ) : null}
        <QuoteFilesCard files={files} />
        {files.length === 0 ? (
          <EmptyStateCard
            title="No files yet"
            description="We’ll attach uploads here automatically once they’re processed."
            className="mt-3"
          />
        ) : null}
      </div>
    </CollapsibleCard>
  );
}

