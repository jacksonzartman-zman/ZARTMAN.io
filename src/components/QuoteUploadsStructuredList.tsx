import { formatDateTime } from "@/lib/formatDate";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";
import type { QuoteUploadGroup } from "@/server/quotes/uploadFiles";
import { CadPreviewButton } from "@/components/shared/CadPreviewButton";

type QuoteUploadsStructuredListProps = {
  uploadGroups: QuoteUploadGroup[];
  /**
   * Legacy previews are backed by `quote_upload_files` and are not canonical.
   * Portals should keep this disabled to avoid non-canonical preview paths.
   */
  enableLegacyPreviews?: boolean;
};

export function QuoteUploadsStructuredList({
  uploadGroups,
  enableLegacyPreviews = false,
}: QuoteUploadsStructuredListProps) {
  if (!uploadGroups || uploadGroups.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      {uploadGroups.map((group) => (
        <UploadGroupCard
          key={group.uploadId}
          group={group}
          enableLegacyPreviews={enableLegacyPreviews}
        />
      ))}
    </section>
  );
}

function UploadGroupCard({
  group,
  enableLegacyPreviews,
}: {
  group: QuoteUploadGroup;
  enableLegacyPreviews: boolean;
}) {
  const entries = Array.isArray(group.entries) ? group.entries : [];
  const archiveEntries = entries.filter((entry) => entry.is_from_archive);
  const nonArchiveEntries = entries.filter((entry) => !entry.is_from_archive);

  const hasArchive = archiveEntries.length > 0;
  const totalCount = entries.length;

  const uploadName = group.uploadFileName ?? "Upload";
  const createdAtLabel = group.uploadCreatedAt
    ? formatDateTime(group.uploadCreatedAt, { includeTime: true })
    : "—";

  return (
    <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">
            {uploadName}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {hasArchive
              ? `ZIP archive • ${archiveEntries.length} file${
                  archiveEntries.length === 1 ? "" : "s"
                } inside`
              : `Upload • ${nonArchiveEntries.length} file${
                  nonArchiveEntries.length === 1 ? "" : "s"
                }`}
          </p>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {createdAtLabel}
        </span>
      </div>

      {totalCount > 0 ? (
        <div className="mt-3 space-y-2">
          {nonArchiveEntries.length > 0 ? (
            <FileList
              title={`Files (${nonArchiveEntries.length})`}
              entries={nonArchiveEntries}
              defaultOpen={nonArchiveEntries.length <= 12 && !hasArchive}
              showPath={false}
              enableLegacyPreviews={enableLegacyPreviews}
            />
          ) : null}
          {archiveEntries.length > 0 ? (
            <FileList
              title={`ZIP contents (${archiveEntries.length})`}
              entries={archiveEntries}
              defaultOpen={archiveEntries.length <= 12}
              showPath
              enableLegacyPreviews={enableLegacyPreviews}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FileList({
  title,
  entries,
  defaultOpen,
  showPath,
  enableLegacyPreviews,
}: {
  title: string;
  entries: QuoteUploadGroup["entries"];
  defaultOpen: boolean;
  showPath: boolean;
  enableLegacyPreviews: boolean;
}) {
  return (
    <details
      className="rounded-xl border border-slate-900/60 bg-black/10 px-4 py-3"
      open={defaultOpen}
    >
      <summary className="cursor-pointer select-none text-xs font-semibold text-slate-300">
        {title}
      </summary>
      <ul className="mt-3 space-y-2">
        {entries.map((entry, index) => (
          <li
            key={`${entry.path}-${index}`}
            className="flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm text-slate-100">
                  {entry.filename}
                </span>
                <FileTypePill filename={entry.filename} extension={entry.extension} />
              </div>
              {showPath && entry.path && entry.path !== entry.filename ? (
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-600">
                  {entry.path}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              {enableLegacyPreviews ? (
                <CadPreviewButton
                  fileId={entry.id}
                  filename={entry.filename}
                  extension={entry.extension}
                  className="text-xs font-semibold text-blue-200 underline-offset-4 hover:underline"
                />
              ) : null}
              <span className="whitespace-nowrap text-[11px] text-slate-500">
                {formatBytes(entry.size_bytes)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FileTypePill({
  filename,
  extension,
}: {
  filename: string;
  extension: string | null;
}) {
  const kind = classifyUploadFileType({ filename, extension });
  const label = kind === "cad" ? "CAD" : kind === "drawing" ? "Drawing" : "Other";
  const classes =
    kind === "cad"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
      : kind === "drawing"
        ? "border-purple-500/30 bg-purple-500/10 text-purple-100"
        : "border-slate-700 bg-slate-900/30 text-slate-300";

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${classes}`}
    >
      {label}
    </span>
  );
}

function formatBytes(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "—";
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

