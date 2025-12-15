import { CollapsibleCard } from "@/components/CollapsibleCard";
import { QuoteFilesCard, type QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";

type QuoteFilesUploadsSectionProps = {
  files: QuoteFileItem[];
  fileCountText: string;
  defaultOpen?: boolean;
};

export function QuoteFilesUploadsSection({
  files,
  fileCountText,
  defaultOpen = true,
}: QuoteFilesUploadsSectionProps) {
  return (
    <CollapsibleCard
      title="Files & uploads"
      description="RFQ files and download links."
      defaultOpen={defaultOpen}
      summary={
        <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
          {fileCountText}
        </span>
      }
    >
      <div className="space-y-2">
        <QuoteFilesCard files={files} />
        {files.length === 0 ? (
          <p className="px-1 text-xs text-slate-500">
            No files to display yet. We&apos;ll attach uploads here automatically once they&apos;re processed.
          </p>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}

