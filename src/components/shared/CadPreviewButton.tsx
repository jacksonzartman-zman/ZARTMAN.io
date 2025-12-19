"use client";

import { useMemo, useState } from "react";
import { classifyCadFileType } from "@/lib/cadRendering";
import { CadPreviewModal } from "@/components/shared/CadPreviewModal";

export function CadPreviewButton({
  fileId,
  filename,
  extension,
  className,
  label = "Preview 3D",
}: {
  fileId: string;
  filename: string;
  extension: string | null;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const classification = useMemo(
    () => classifyCadFileType({ filename, extension }),
    [extension, filename],
  );

  if (!classification.ok) {
    return null;
  }

  const tooltip =
    classification.type === "step"
      ? "STEP previews are experimental; if they fail, we’ll show you the reason and you can still download the file."
      : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        title={tooltip}
      >
        {label}
      </button>
      {open ? (
        <CadPreviewModal
          fileId={fileId}
          filename={filename}
          title="3D Preview"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

