import { CollapsibleCard } from "@/components/CollapsibleCard";
import { QuoteFilesCard, type QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { QuoteUploadsStructuredList } from "@/components/QuoteUploadsStructuredList";
import type { QuoteUploadGroup } from "@/server/quotes/uploadFiles";

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
};

export function QuoteFilesUploadsSection({
  files,
  fileCountText,
  defaultOpen = true,
  uploadGroups,
}: QuoteFilesUploadsSectionProps) {
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

